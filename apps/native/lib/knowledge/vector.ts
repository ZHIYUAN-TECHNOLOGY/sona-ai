// Pure vector math for on-device semantic retrieval. Deterministic + unit-tested; no
// native deps. The embedder (useTextEmbeddings) produces the vectors; this ranks them.

type Vec = Float32Array | number[];

export function dot(a: Vec, b: Vec): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function norm(a: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

/** Cosine similarity in [-1, 1]; 0 if either vector is zero-length or all-zero. */
export function cosineSim(a: Vec, b: Vec): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

export interface Ranked {
  index: number;
  score: number;
}

/**
 * Rank `docs` by cosine similarity to `query`, best first. Returns the top `k`
 * (default all) with scores. `minScore` drops weak matches (default -1 = keep all).
 */
export function topKByCosine(query: Vec, docs: Vec[], k = docs.length, minScore = -1): Ranked[] {
  const ranked: Ranked[] = docs.map((d, index) => ({ index, score: cosineSim(query, d) }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked.filter((r) => r.score >= minScore).slice(0, k);
}
