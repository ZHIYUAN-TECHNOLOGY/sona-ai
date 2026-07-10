// On-device note search. Pure, deterministic lexical ranking over the clinician's
// stored notes — runs entirely on-device (the notes never leave the phone; searching
// them locally does not cross the moat). This is the JS-first cut of semantic search:
// the SearchDoc shape and rankNotes signature stay stable so an on-device embedding
// model (react-native-rag) can later re-rank the same docs without changing callers.

/** A searchable note: de-identified title + the (locally re-identified) note body. */
export interface SearchDoc {
  consultId: string;
  title: string;
  /** Note body — SOAP sections + orders concatenated. May be empty for a bare draft. */
  text: string;
  createdAt: number;
  status: string;
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
  /** A short context window around the best match, for the result row. */
  snippet: string;
}

// Common words that add noise to a clinical query. Kept tiny on purpose — over-
// stemming hurts recall on short notes.
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
  "was", "were", "has", "had", "no", "not", "patient", "pt",
]);

function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

// Context snippet: a ~90-char window centred on the earliest query-term hit, with
// ellipses. Falls back to the head of the text, then the title.
function makeSnippet(doc: SearchDoc, qTokens: string[]): string {
  const text = doc.text.trim() || doc.title;
  const lower = text.toLowerCase();
  let idx = -1;
  for (const qt of qTokens) {
    const i = lower.indexOf(qt);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) return text.length > 90 ? `${text.slice(0, 90).trim()}…` : text;
  const start = Math.max(0, idx - 35);
  const end = Math.min(text.length, idx + 55);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * Rank notes against a free-text query. Scoring rewards, in order: an exact phrase in
 * the title, term hits in the title (weighted high), the full query as a phrase in the
 * body, term hits in the body, and prefix matches ("cough" → "coughing"). A coverage
 * bonus favours notes that contain every query term. Returns only positive-score hits,
 * best first, ties broken by recency. An empty/stopword-only query returns [].
 */
export function rankNotes(query: string, docs: SearchDoc[]): SearchHit[] {
  const qTokens = tokenize(query).filter((t) => t.length >= 2 && !STOP.has(t));
  if (qTokens.length === 0) return [];
  const phrase = query.toLowerCase().trim();

  const hits: SearchHit[] = [];
  for (const doc of docs) {
    const titleTokens = tokenize(doc.title);
    const bodyTokens = tokenize(doc.text);
    let score = 0;
    let covered = 0;

    for (const qt of qTokens) {
      const inTitle = titleTokens.filter((t) => t === qt).length;
      const inBody = bodyTokens.filter((t) => t === qt).length;
      const prefixTitle = titleTokens.filter((t) => t !== qt && t.startsWith(qt)).length;
      const prefixBody = bodyTokens.filter((t) => t !== qt && t.startsWith(qt)).length;
      score += inTitle * 5 + prefixTitle * 3 + inBody * 1 + prefixBody * 0.5;
      if (inTitle || inBody || prefixTitle || prefixBody) covered++;
    }

    if (covered === qTokens.length) score += 3; // all terms present
    if (doc.title.toLowerCase().includes(phrase)) score += 6;
    else if (doc.text.toLowerCase().includes(phrase)) score += 3;

    if (score > 0) hits.push({ doc, score, snippet: makeSnippet(doc, qTokens) });
  }

  hits.sort((a, b) => b.score - a.score || b.doc.createdAt - a.doc.createdAt);
  return hits;
}
