import type { Language } from "@sona-ai/domain/discharge";

import type { Library } from "./context";
import type { RetrievalHit } from "./contracts";

/**
 * The hospital's patient leaflets behind a Sona Care answer, typed (care.ask) or spoken (the voice agents): general
 * advice the hospital vetted, found for each question by the library's hybrid search (packages/retrieval), which scopes
 * a patient's search to her own hospital's documents of kind "leaflet": a guideline, a doctor's own source or another
 * hospital's never reaches her. Facts about her still come from her record alone (recordText). The leaflets go to Gemma
 * under their own heading, numbered; Gemma says which numbers it used, and those become the answer's `sources`.
 */
export type Passage = { n: number; title: string; kind: "leaflet"; text: string };
/** What an answer rested on, as the patient is shown it: the leaflet's title. */
export type Source = { title: string; kind: "leaflet" };

/**
 * How long a question waits for its leaflets, from when it is asked. The search runs beside what an answer already waits
 * for (her record being read, the call's context), so this is the most it can add before Gemma is asked; in time, the
 * search is an embedding and two queries. Late, failed or with no library, the answer goes on as it did before leaflets,
 * with none offered (`sources: []`). An embedder that fails is not that: the search itself falls back to keywords.
 * ponytail: an embedder that hangs is given 3 s by the search before keywords answer alone (workers-models), which is
 * past this limit, so that question gets no leaflets; give a patient's search a shorter embedder limit if it happens.
 */
export const PASSAGES_MS = 800;
/** Leaflets offered to Gemma for one question: three short ones are about 200 tokens of its prompt. */
const PASSAGES_MAX = 3;
/** Hits asked for: each leaflet is stored once per language, so three leaflets may come back three times each. */
const HITS = PASSAGES_MAX * 3;

/** The leaflet hits for a question, best first; none when late (PASSAGES_MS) or failed. Never rejects, so nothing after it is held up by a fault here. */
export function leafletHits(library: Library | undefined, hospitalId: string, question: string): Promise<RetrievalHit[]> {
  if (!library) return Promise.resolve([]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const none = (why: string) => (error?: unknown) => { console.error(`leaflets not searched: ${why}`, error ?? ""); return [] as RetrievalHit[]; };
  const late = new Promise<RetrievalHit[]>(resolve => { timer = setTimeout(() => resolve(none(`over ${PASSAGES_MS} ms`)()), PASSAGES_MS); });
  // The search's own limit on a query is 500 characters; a long spoken turn is searched by its start.
  const found = Promise.resolve().then(() => library.search({ query: question.slice(0, 500), hospitalId, patient: true, k: HITS })).catch(none("failed"));
  return Promise.race([found, late]).finally(() => clearTimeout(timer));
}

/** A leaflet's language, from its document id (the seed's ":en"; packages/db seedLeaflets), and the leaflet without it. */
const LANGUAGE = /:(en|ms|zh)$/;

/**
 * The passages offered for a question, numbered from 1: the best three leaflets, each once, in the patient's language
 * when that copy was found (else the copy that was: the advice is the same, and Gemma answers in her language anyway).
 */
export function passagesIn(hits: RetrievalHit[], language: Language): Passage[] {
  const byLeaflet = new Map<string, RetrievalHit>();
  for (const hit of hits) {
    const leaflet = hit.documentId.replace(LANGUAGE, "");
    if (!byLeaflet.has(leaflet) || LANGUAGE.exec(hit.documentId)?.[1] === language) byLeaflet.set(leaflet, hit);
  }
  return [...byLeaflet.values()].slice(0, PASSAGES_MAX).map((hit, i) => ({ n: i + 1, title: hit.tags.title ?? hit.tags.source, kind: "leaflet", text: hit.text }));
}

/** The leaflets as Gemma reads them, after her record and under their own heading (the prompts' rules name it). */
export const leafletsText = (passages: Passage[] = []) => `Hospital's general leaflets (advice for any patient, not facts about this patient):\n${
  passages.length ? passages.map(p => `[${p.n}] ${p.title}: ${p.text}`).join("\n") : "None found for this question."}`;

/** The leaflets Gemma says it used (`cites`, as it wrote them): only numbers that were offered, each leaflet once. */
export function citedSources(cites: unknown, passages: Passage[]): Source[] {
  const used = new Set(Array.isArray(cites) ? cites : []);
  return passages.filter(p => used.has(p.n)).map(({ title, kind }) => ({ title, kind }));
}

/** An answer's words without a leaflet's number in them ("[1]"): the numbers are for `cites`, never shown or spoken. */
export const unnumbered = (text: string) => text.replace(/\s*\[\d+\]/g, "");
