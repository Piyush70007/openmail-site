// In-browser version of OpenMail's reply checks, for the homepage playground.
//
// The tokenizer, stemmer and BM25 ranking mirror backend/retrieval.py, and the
// risk patterns mirror backend/ai.py, so the safety check, the document search
// and the word-for-word citation check really run on whatever the visitor
// types. Choosing the quote is the language model's job in production; the
// playground shows an example model answer for its sample emails only, and
// needs no server, API key or network call.

const STOPWORDS = new Set(
  `a about above after again all also am an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers him his how i
if in into is it its just me more most my no nor not now of off on once only or other our ours out over own please
same she should so some such than thank thanks that the their theirs them then there these they this those through to
too under until up very was we were what when where which while who whom why will with would you your yours hi hello
dear regards`.split(/\s+/),
);

const SUFFIXES = [
  ["ies", 5],
  ["ing", 6],
  ["ed", 5],
  ["es", 5],
  ["s", 4],
];
const K1 = 1.5;
const B = 0.75;

export const RISK_CHECKS = [
  [
    /\b(chargeback|money back|reimbursement|refund me|refund (?:my|the|for)\b|(?:need|want|request|seeking).{0,15}\brefund\b|billing (?:dispute|issue|error|problem)|payment (?:failed|error|problem|dispute|charged|unrecognized|unauthorized)|charged (?:twice|incorrectly|by mistake|without permission)|dispute (?:a |the )?(?:charge|invoice|payment))\b/i,
    "This is about a payment problem or a personal refund.",
  ],
  [
    /\b(?:i\s+(?:want|need|would like)\s+to|please|can you|could you)\s+cancel\b|\b(?:cancel|terminate|end)\s+(?:my|our|the)\s+(?:account|subscription|plan|service|order|booking|reservation)\b/i,
    "A person needs to confirm a cancellation.",
  ],
  [
    /\b(appointment|calendar|book(?:ing)?|reserve|schedule|meeting time)\b/i,
    "A person needs to check the calendar.",
  ],
  [
    /\b(lawyer|attorney|legal|lawsuit|court|regulator|police|liability|contract dispute)\b/i,
    "This raises a legal matter.",
  ],
  [
    /\b(password|passcode|verification code|locked out|(?:cannot|can't|unable to)\s+(?:sign|log)\s+in|hacked|compromised|delete my account|personal data|bank account|credit card number|\bcvv\b|\biban\b)\b/i,
    "This concerns account security or sensitive personal data.",
  ],
  [
    /\b(complaint|complain|angry|unacceptable|discrimination|harass(?:ment)?|threat|emergency|injur(?:y|ed)|unsafe)\b/i,
    "This is a complaint or safety concern.",
  ],
  [
    /\b(ignore|disregard|override|forget|bypass).{0,80}\b(previous|prior|above|system|developer|all|safety|security).{0,40}\b(instructions?|rules?|prompts?|policies)\b/i,
    "This contains instructions aimed at the AI, not a customer question.",
  ],
  [
    /\b(reveal|show|print|send|disclose|repeat).{0,60}\b(system prompt|api key|secret key|password|credential|hidden instructions)\b/i,
    "This asks for private system information.",
  ],
];

export function stem(token) {
  for (const [suffix, minimum] of SUFFIXES) {
    if (
      token.endsWith(suffix) &&
      token.length >= minimum &&
      !token.endsWith("ss")
    )
      return token.slice(0, -suffix.length) + (suffix === "ies" ? "y" : "");
  }
  return token;
}

export function tokenize(text) {
  const words =
    String(text ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || [];
  return words.filter((word) => !STOPWORDS.has(word)).map(stem);
}

function inverseFrequencies(tokenLists) {
  const containing = new Map();
  for (const tokens of tokenLists)
    for (const term of new Set(tokens))
      containing.set(term, (containing.get(term) || 0) + 1);
  const total = tokenLists.length;
  return (term) => {
    const count = containing.get(term) || 0;
    return count ? Math.log(1 + (total - count + 0.5) / (count + 0.5)) : 0;
  };
}

function bm25(queryTerms, tokenLists, idf) {
  const average =
    tokenLists.reduce((sum, tokens) => sum + tokens.length, 0) /
      tokenLists.length || 1;
  return tokenLists.map((tokens) => {
    let score = 0;
    for (const term of queryTerms) {
      const occurrences = tokens.filter((token) => token === term).length;
      if (!occurrences) continue;
      const norm = 1 - B + (B * tokens.length) / average;
      score += (idf(term) * occurrences * (K1 + 1)) / (occurrences + K1 * norm);
    }
    return score;
  });
}

export function riskReason(text) {
  for (const [pattern, reason] of RISK_CHECKS)
    if (pattern.test(text)) return reason;
  return "";
}

export function createEngine(documents) {
  const passages = [];
  documents.forEach((document) => {
    const title = document.title.replace(/\.[a-z]+$/i, "");
    document.sections.forEach((text, index) => {
      passages.push({
        title,
        section: index + 1,
        text,
        tokens: [...tokenize(title), ...tokenize(title), ...tokenize(text)],
      });
    });
  });
  const tokenLists = passages.map((passage) => passage.tokens);
  const idf = inverseFrequencies(tokenLists);

  // Safety check, then rank every passage against the email.
  function analyze(question) {
    const text = String(question ?? "").trim();
    const base = { question: text, documents: documents.length, searched: passages.length };
    const risk = riskReason(text);
    if (risk) return { ...base, risk, matches: [] };
    const scores = bm25([...new Set(tokenize(text))], tokenLists, idf);
    const ranked = passages
      .map((passage, index) => ({ passage, score: scores[index] }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const top = ranked[0]?.score || 1;
    return {
      ...base,
      risk: "",
      matches: ranked.map(({ passage, score }) => ({
        title: passage.title,
        section: passage.section,
        text: passage.text,
        relative: score / top,
      })),
    };
  }

  return { analyze, passages: passages.length, documents: documents.length };
}

// The citation check: a quote counts only if it appears word for word in a
// passage that was actually retrieved.
export function verifyQuote(matches, quote) {
  const wanted = String(quote ?? "").trim();
  if (wanted.length < 20) return null;
  return matches.find((match) => match.text.includes(wanted)) || null;
}
