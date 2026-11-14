"""Query-aware selection of approved knowledge for the model context.

Approved knowledge can be far larger than the context budget. Instead of
keeping only the first characters of each source, every source is split into
sentence-aligned chunks, the chunks are ranked against the incoming email with
BM25, and the best ones are packed into the budget.

Every selected chunk is an exact slice of its source, and neighbouring slices
are merged back together, so the citation check (which requires a verbatim
quote from the source text) keeps working unchanged. The module is pure
Python and deterministic: no network calls, embeddings or extra dependencies.
"""
import math
import re
import unicodedata
from collections import Counter

CHUNK_TARGET_CHARS = 400
CHUNK_MAX_CHARS = 700
BM25_K1 = 1.5
BM25_B = 0.75
TITLE_WEIGHT = 2
GAP = "\n\n"

STOPWORDS = frozenset("""
a about above after again all also am an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers him his how i
if in into is it its just me more most my no nor not now of off on once only or other our ours out over own please
same she should so some such than thank thanks that the their theirs them then there these they this those through to
too under until up very was we were what when where which while who whom why will with would you your yours hi hello
dear regards
""".split())

WORD = re.compile(r"[^\W_]+", re.UNICODE)
BOUNDARY = re.compile(r"(?<=[.!?])\s+|\n+")


def stem(token):
    """Fold common English inflections so 'refunds' matches 'refund'."""
    for suffix, minimum in (("ies", 5), ("ing", 6), ("ed", 5), ("es", 5), ("s", 4)):
        if token.endswith(suffix) and len(token) >= minimum and not token.endswith("ss"):
            return token[:-len(suffix)] + ("y" if suffix == "ies" else "")
    return token


def tokenize(text):
    normalized = unicodedata.normalize("NFKC", str(text or "")).lower()
    return [stem(token) for token in WORD.findall(normalized) if token not in STOPWORDS]


def split_spans(text, target=CHUNK_TARGET_CHARS, maximum=CHUNK_MAX_CHARS):
    """Return contiguous (start, end) spans that cover the text on sentence boundaries."""
    text = str(text or "")
    if not text:
        return []
    cuts = [match.end() for match in BOUNDARY.finditer(text)]
    if not cuts or cuts[-1] != len(text):
        cuts.append(len(text))
    spans, start, previous = [], 0, 0
    for cut in cuts:
        # Close the chunk before a sentence that would push it past the maximum.
        if cut - start > maximum and previous > start:
            spans.append((start, previous))
            start = previous
        # A single sentence longer than the maximum is split on whitespace.
        while cut - start > maximum:
            window = text.rfind(" ", start + target, start + maximum)
            end = window + 1 if window > start else start + maximum
            spans.append((start, end))
            start = end
        if cut - start >= target:
            spans.append((start, cut))
            start = cut
        previous = cut
    if start < len(text):
        spans.append((start, len(text)))
    return [span for span in spans if text[span[0]:span[1]].strip()]


def bm25_scores(query_tokens, documents):
    """Score tokenized documents against the query with Okapi BM25."""
    if not documents:
        return []
    count = len(documents)
    average = sum(len(tokens) for tokens in documents) / count or 1.0
    frequencies = [Counter(tokens) for tokens in documents]
    scores = [0.0] * count
    for term in set(query_tokens):
        containing = sum(1 for frequency in frequencies if term in frequency)
        if not containing:
            continue
        idf = math.log(1 + (count - containing + 0.5) / (containing + 0.5))
        for index, frequency in enumerate(frequencies):
            occurrences = frequency.get(term, 0)
            if occurrences:
                length_norm = 1 - BM25_B + BM25_B * len(documents[index]) / average
                scores[index] += idf * occurrences * (BM25_K1 + 1) / (occurrences + BM25_K1 * length_norm)
    return scores


def leading_selection(sources, budget):
    """Legacy behaviour: the first characters of each source, in the given order."""
    selected = []
    for source in sources:
        if budget <= 0:
            break
        text = str(source.get("text") or "")[:min(source.get("cap") or budget, budget)].strip()
        if text:
            selected.append({**source, "text": text})
            budget -= len(text)
    return selected


def strip_internal(sources):
    return [{key: value for key, value in source.items() if key != "cap"} for source in sources]


def select_sources(sources, query, budget):
    """Choose which approved text fits the budget, most relevant to the query first.

    Each source is a dict with id, kind, title, text and an optional "cap" (the
    number of leading characters the legacy selection would keep). Returns
    (selected_sources, stats). Selected text is always made of verbatim slices
    of the original source text.
    """
    sources = [source for source in sources if str(source.get("text") or "").strip()]
    stats = {"strategy": "full", "candidateSources": len(sources), "candidateChunks": 0,
             "selectedSources": 0, "selectedChunks": 0, "matchedChunks": 0}
    if budget <= 0 or not sources:
        stats["strategy"] = "empty"
        return [], stats
    if sum(len(source["text"]) for source in sources) <= budget:
        stats["selectedSources"] = len(sources)
        return strip_internal(sources), stats

    query_tokens = tokenize(query)
    chunks = []
    for source_index, source in enumerate(sources):
        title_tokens = tokenize(source.get("title")) * TITLE_WEIGHT
        for chunk_index, (start, end) in enumerate(split_spans(source["text"])):
            chunks.append({"source": source_index, "order": chunk_index, "start": start, "end": end,
                           "tokens": title_tokens + tokenize(source["text"][start:end])})
    stats["candidateChunks"] = len(chunks)
    scores = bm25_scores(query_tokens, [chunk["tokens"] for chunk in chunks]) if query_tokens else []
    if not any(scores):
        selected = leading_selection(sources, budget)
        stats.update(strategy="leading", selectedSources=len(selected))
        return strip_internal(selected), stats

    for chunk, score in zip(chunks, scores):
        chunk["score"] = score
    stats["matchedChunks"] = sum(1 for chunk in chunks if chunk["score"] > 0)
    # Relevant chunks first; unmatched chunks keep their original order and only
    # fill whatever budget is left, so nothing is dropped that used to fit.
    ranked = sorted(chunks, key=lambda chunk: (-chunk["score"], chunk["source"], chunk["order"]))
    chosen, remaining = {}, budget
    for chunk in ranked:
        cost = chunk["end"] - chunk["start"] + len(GAP)
        if cost > remaining:
            if chunk["score"] > 0:
                continue
            break
        chosen.setdefault(chunk["source"], []).append(chunk)
        remaining -= cost
        stats["selectedChunks"] += 1

    best = {index: max(chunk["score"] for chunk in picked) for index, picked in chosen.items()}
    selected = []
    for source_index in sorted(chosen, key=lambda index: (-best[index], index)):
        source, merged = sources[source_index], []
        for chunk in sorted(chosen[source_index], key=lambda chunk: chunk["start"]):
            if merged and merged[-1][1] == chunk["start"]:
                merged[-1][1] = chunk["end"]
            else:
                merged.append([chunk["start"], chunk["end"]])
        text = GAP.join(source["text"][start:end].strip() for start, end in merged)
        selected.append({**source, "text": text})
    stats.update(strategy="bm25", selectedSources=len(selected))
    return strip_internal(selected), stats
