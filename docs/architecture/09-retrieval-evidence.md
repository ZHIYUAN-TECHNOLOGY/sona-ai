# 09 · Evidence answers with citations

[Diagram](09-retrieval-evidence.html) · [SVG](09-retrieval-evidence.svg) · [PNG](09-retrieval-evidence.png) · [source](09-retrieval-evidence.archify.json)

**Answers:** where an evidence answer's sources come from, how they are ranked, and how a claim earns its citation.

## What it shows

- **`evidence.stream`** (`packages/api/src/routers/evidence.ts`) streams steps (search, read, write, bottom line, each claim) over oRPC; `evidence.ask` returns the whole answer. Sona Pro web and iPhone both use it.
- Three sources are read at once:
  - **PubMed** (`packages/api/src/pubmed.ts`): esearch then efetch at `eutils.ncbi.nlm.nih.gov`, 4 s per call; first guidelines, systematic reviews, meta-analyses and RCTs with abstracts in English, then a top-up; at most 5 studies. Searches and abstracts are cached in Postgres (`pubmed_searches` for 7 days, `pubmed_articles`); if PubMed fails, the cache answers.
  - **Patient record** (only in a visit): `recordFacts` plus the visit's saved note, with the name, its parts and the record number removed by rules. It is a numbered source the claims can cite.
  - **Hybrid search** (`packages/retrieval/src/retrieval.ts`): Postgres full-text (`plainto_tsquery('english')`, lexemes ORed) and pgvector cosine on 768-d EmbeddingGemma vectors, 50 each, fused by reciprocal rank fusion (k = 60); bge-reranker on `sona-voice` reorders the fused top 20 (8 s, skipped on failure); top 3 passages.
- **Order of numbered sources:** the patient's X-ray films, then the patient record, then PubMed studies, then library passages.
- **Sona Med** writes claims that cite `[n]`; **citation checks** drop a claim that cites nothing it was shown or a number out of range (`sourcedClaims`), keep a quote only if the cited source contains it word for word (`quotedClaims`), and keep a patient point only if its fact is in the record text (`recordedPoints`). Each answer writes a provenance row.

## X-ray similarity (same embed box)

`xray.upload` stores the film in R2, indexes its reading as library document `xray:<visit>` (with Malay and Chinese terms), and stores a 512-d BiomedCLIP vector in `image_vectors`. `xray.similar` finds the hospital's nearest films from a film or from text. Only available when `sona-embed` is named.

## Known limits

- No reranker score floor yet, so weak passages can still be shown.
- The library index of a film includes the patient's name; passages are not de-identified before Sona Med (see [03](03-data-privacy.md)).
- Laya routing is used only by the iPhone app, and only after the regex router (which sends evidence questions straight here).

Checked against code at `cd76571b` on 8 Oct 2026.
