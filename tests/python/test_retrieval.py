"""Knowledge retrieval: chunking, ranking, budget packing and the offline evaluation gate."""
import json
import unittest
from unittest.mock import patch

from backend import ai, ai_platform as platform
from backend.retrieval import bm25_scores, select_sources, split_spans, tokenize
from evals.retrieval_eval import REPORT, SITE_DATA, evaluate, load_golden, render, site_data

OWNER, MAILBOX, MESSAGE = (f"{digit * 8}-{digit * 4}-4{digit * 3}-8{digit * 3}-{digit * 12}" for digit in "123")
FILLER = "Our studio opened in 2019 and works with small companies across Europe on design projects. "
ANSWER = "Returned items are refunded to the original payment method within ten working days."


def long_document(answer_position=40, sentences=80):
    parts = [FILLER] * sentences
    parts[answer_position] = ANSWER + " "
    return "".join(parts).strip()


class RetrievalUnitTests(unittest.TestCase):
    def test_tokenize_normalizes_stems_and_drops_stopwords(self):
        self.assertEqual(tokenize("What are the REFUNDS policies?"), ["refund", "policy"])
        self.assertEqual(tokenize("ｒｅｆｕｎｄ"), ["refund"])
        self.assertEqual(tokenize(None), [])

    def test_spans_cover_the_text_exactly_and_respect_the_maximum(self):
        for text in (long_document(), "word " * 900, "One short sentence.", "A\n\nB\n\nC", "x" * 2000):
            spans = split_spans(text)
            self.assertEqual(spans[0][0], 0)
            self.assertEqual(spans[-1][1], len(text))
            for (_, end), (start, _) in zip(spans, spans[1:]):
                self.assertEqual(end, start)
            self.assertTrue(all(end - start <= 700 for start, end in spans))
        self.assertEqual(split_spans(""), [])

    def test_bm25_prefers_rare_matching_terms(self):
        documents = [tokenize(FILLER), tokenize(ANSWER), tokenize(FILLER + FILLER)]
        scores = bm25_scores(tokenize("refund for returned items"), documents)
        self.assertEqual(scores.index(max(scores)), 1)
        self.assertEqual(bm25_scores(["anything"], []), [])

    def test_small_knowledge_is_kept_whole_and_in_order(self):
        sources = [{"id": "a", "title": "A", "text": "First.", "cap": 5000}, {"id": "b", "title": "B", "text": "Second."}]
        selected, stats = select_sources(sources, "second", 1000)
        self.assertEqual(selected, [{"id": "a", "title": "A", "text": "First."}, {"id": "b", "title": "B", "text": "Second."}])
        self.assertEqual(stats["strategy"], "full")

    def test_answer_deep_in_a_long_document_is_selected_verbatim(self):
        document = long_document()
        self.assertGreater(document.index(ANSWER), 3000)
        sources = [{"id": "document:1", "title": "Handbook.pdf", "text": document, "cap": 5000},
                   {"id": "document:2", "title": "History.pdf", "text": FILLER * 80, "cap": 5000}]
        selected, stats = select_sources(sources, "How do refunds work for returned items?", 3000)
        self.assertEqual(stats["strategy"], "bm25")
        self.assertEqual(selected[0]["id"], "document:1")
        self.assertEqual(ai.find_approved_evidence_quote(selected[0]["text"], ANSWER), ANSWER)
        self.assertLessEqual(sum(len(source["text"]) for source in selected), 3000)
        self.assertNotIn("cap", selected[0])

    def test_selected_text_is_only_verbatim_source_text(self):
        document = long_document()
        selected, _ = select_sources([{"id": "d", "title": "Doc", "text": document}], "refund returned items", 1500)
        for piece in selected[0]["text"].split("\n\n"):
            self.assertIn(piece, document)

    def test_unmatched_or_empty_query_falls_back_to_leading_text(self):
        sources = [{"id": "d", "title": "Doc", "text": long_document(), "cap": 500}]
        for query in ("", "zzzz qqqq"):
            selected, stats = select_sources(sources, query, 2000)
            self.assertEqual(stats["strategy"], "leading")
            self.assertEqual(selected[0]["text"], sources[0]["text"][:500].strip())

    def test_empty_inputs(self):
        self.assertEqual(select_sources([], "question", 1000)[0], [])
        self.assertEqual(select_sources([{"id": "d", "text": "Text"}], "question", 0)[0], [])


class RetrievalContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_live_reply_context_finds_an_answer_beyond_the_old_document_cutoff(self):
        document = long_document(answer_position=70, sentences=400)
        self.assertGreater(document.index(ANSWER), 5000)
        async def db(path, options=None):
            if path.startswith("mailboxes?"): return [{"id": MAILBOX, "status": "active", "address": "support@example.test"}]
            if path.startswith("messages?"): return [{"id": MESSAGE, "direction": "inbound", "folder": "inbox", "subject": "Refund", "text_body": "How are returned items refunded?"}]
            if path.startswith("ai_profiles?"): return [{"enabled": True, "company_name": "Example"}]
            if path.startswith("rpc/ensure_"): return [{"id": "rep", "kind": "support", "enabled": True}]
            if path.startswith("ai_mailbox_settings?"): return [{"representative_id": "rep"}]
            if path.startswith("ai_knowledge_entries?"): return []
            if path.startswith("ai_knowledge_documents?"): return [{"id": "handbook", "file_name": "Handbook.pdf", "extracted_text": document}]
            self.fail(path)
        with patch.object(ai, "config", return_value={"groqKey": "synthetic", "groqModel": "synthetic"}):
            result = await ai.load_reply_context(OWNER, MAILBOX, MESSAGE, db)
        source = next(item for item in result["sources"] if item["id"] == "document:handbook")
        self.assertEqual(ai.find_approved_evidence_quote(source["text"], ANSWER), ANSWER)
        self.assertEqual(result["retrieval"]["strategy"], "bm25")
        self.assertLessEqual(sum(len(item["text"]) for item in result["sources"]), ai.MAX_CONTEXT_CHARS)
        self.assertEqual(result["sources"][0]["id"], "profile:company_name")

    async def test_simulator_context_uses_the_same_retrieval(self):
        document = long_document(answer_position=70, sentences=400)
        async def db(path, options=None):
            if path.startswith("rpc/"): return [{"id": "rep", "owner_id": OWNER, "kind": "support", "enabled": True}]
            if path.startswith("ai_profiles?"): return [{"enabled": True, "company_name": "Example"}]
            if path.startswith("ai_knowledge_entries?"): return []
            return [{"id": "handbook", "file_name": "Handbook.pdf", "extracted_text": document}]
        with patch.object(platform, "config", return_value={"groqKey": "synthetic"}):
            context = await platform.approved_context(OWNER, "rep", db, query="Refund\nHow are returned items refunded?")
        source = next(item for item in context["sources"] if item["id"] == "document:handbook")
        self.assertIn(ANSWER, source["text"])
        self.assertEqual(context["retrieval"]["strategy"], "bm25")


class RetrievalEvaluationGate(unittest.TestCase):
    """Fails the build if a change makes knowledge selection measurably worse."""

    def test_golden_set_is_well_formed(self):
        sources, cases = load_golden()
        self.assertGreaterEqual(len(cases), 40)
        self.assertEqual(len({case["question"] for case in cases}), len(cases))
        self.assertEqual(len(sources), 5)

    def test_retrieval_beats_leading_text_and_holds_its_recall_floor(self):
        report = evaluate()
        floors = {0.15: 0.75, 0.25: 0.78, 0.5: 0.85, 0.75: 0.9}
        for row in report["rows"]:
            before, now = (row["results"][name]["recall"] for name in ("Leading text (before)", "BM25 retrieval (now)"))
            with self.subTest(share=row["share"]):
                self.assertGreater(now, before)
                self.assertGreaterEqual(now, floors[row["share"]])

    def test_published_report_and_homepage_numbers_match_a_fresh_run(self):
        report = evaluate()
        self.assertEqual(REPORT.read_text(encoding="utf-8"), render(report))
        self.assertEqual(json.loads(SITE_DATA.read_text(encoding="utf-8")), site_data(report))


if __name__ == "__main__":
    unittest.main()
