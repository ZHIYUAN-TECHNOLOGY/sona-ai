import { documents, encounters, observations, patients, provenance, pubmedArticles } from "@sona-ai/db/schema/clinical";
import { STUDIES, authoredAnswer, curb65FromObservations, isRehearsed, pubmedUrl, sourcedClaims, studyKind, type Claim, type ObservationRow, type Reference } from "@sona-ai/domain/evidence";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { Context } from "../context";
import { stubModels } from "../models";
import { protectedProcedure } from "../index";
import { fetchArticles, searchEvidence, searchTerms, type Article } from "../pubmed";

/**
 * Flow 4, the evidence answer (docs/evidence-answer-spec.md): short claims each citing numbered
 * sources, one reference list (PubMed studies, then library passages), follow-ups, and the patient's
 * CURB-65 from recorded readings. The rehearsed question and its suggested follow-ups answer from
 * authored content so the stage cannot fail on the network or a cold model; anything else goes to
 * the model seam (a labelled mock until the models are hosted). No source, no claim: the route drops
 * any claim citing nothing or a number not in the list. Fetched articles are cached, so a question
 * asked once still has its sources when PubMed is unreachable.
 */
const REHEARSED = {
  matches: isRehearsed,
  // Checked against PubMed: ATS/IDSA 2019 guideline, Blum 2015 (Lancet), CAPE COD 2023 (NEJM).
  pmids: ["31573350", "25608756", "36942789"],
};

type Cached = typeof pubmedArticles.$inferSelect;
const fromCache = (r: Cached): Article => ({ pmid: r.pmid, title: r.title, journal: r.journal, year: r.year, publicationTypes: r.publicationTypes, kind: studyKind(r.publicationTypes), conclusion: r.conclusion });

/** The articles, live from PubMed (and cached) when it answers, else from the cache. */
async function articlesFor(db: Context["db"], fetcher: typeof fetch, terms: string[], rehearsed: boolean) {
  try {
    const pmids = rehearsed ? REHEARSED.pmids : await searchEvidence(terms, fetcher);
    // An article without an abstract has nothing to cite (the search asks for abstracts; this catches the odd one without).
    const articles = (await fetchArticles(pmids, fetcher)).filter(a => rehearsed || a.conclusion);
    if (articles.length) await db.insert(pubmedArticles).values(articles.map(a => ({ pmid: a.pmid, title: a.title, journal: a.journal, year: a.year, publicationTypes: a.publicationTypes, conclusion: a.conclusion })))
      .onConflictDoUpdate({ target: pubmedArticles.pmid, set: { title: sql`excluded.title`, conclusion: sql`excluded.conclusion`, publicationTypes: sql`excluded.publication_types`, fetchedAt: sql`now()` } });
    return { articles, pubmed: "live" as const };
  } catch {
    // ponytail: only the rehearsed question's IDs are known offline; other questions need PubMed's search.
    const rows = rehearsed ? await db.select().from(pubmedArticles).where(inArray(pubmedArticles.pmid, REHEARSED.pmids)) : [];
    const articles = REHEARSED.pmids.flatMap(id => rows.filter(r => r.pmid === id)).map(fromCache);
    return { articles, pubmed: articles.length ? ("cached" as const) : ("unavailable" as const) };
  }
}

/**
 * Up to three passages from the library (the shared guidelines and the hospital's own uploads, and
 * the doctor's own) for the question, each with its document title and section.
 * ponytail: the nearest passages come back with no relevance floor; add a reranker score floor when bge-reranker is on.
 */
async function passagesFor(context: Context, hospitalId: string, question: string) {
  const hits = context.library ? await context.library.search({ query: question, hospitalId, userId: context.session?.user.id, k: 3 }) : [];
  if (!hits.length) return [];
  const docs = await context.db.select({ id: documents.id, title: documents.title }).from(documents).where(inArray(documents.id, hits.map(h => h.documentId)));
  const title = new Map(docs.map(d => [d.id, d.title]));
  return hits.map(h => ({ id: h.sourceId, documentId: h.documentId, title: title.get(h.documentId) ?? h.tags.source, section: h.tags.section, from: h.tags.source, year: h.tags.year, text: h.text }));
}

const turn = z.object({ question: z.string().trim().min(1).max(500), answer: z.string().max(4000) });

export const evidenceRouter = {
  ask: protectedProcedure.input(z.object({ encounterId: z.string().min(1), question: z.string().trim().min(1).max(500), thread: z.array(turn).max(4).default([]) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const [visit] = await db.select({ patientId: patients.id, name: patients.name, age: patients.age }).from(encounters).innerJoin(patients, eq(patients.id, encounters.patientId))
      .where(and(eq(encounters.id, input.encounterId), eq(encounters.hospitalId, hospitalId)));
    if (!visit) throw new ORPCError("NOT_FOUND", { message: `No encounter ${input.encounterId}` });

    // The rehearsed question, or one of its suggested follow-ups word for word, answers from authored content.
    const authored = authoredAnswer(input.question);
    // PubMed gets the question's key terms (a follow-up keeps the thread's topic), never the patient's name or record number.
    const terms = searchTerms(input.question, input.thread.map(t => t.question), [visit.name, visit.patientId]);
    const { articles, pubmed } = await articlesFor(db, context.fetch ?? fetch, terms, Boolean(authored));
    // Authored answers show their reviewed summary of each study (a guideline's abstract rarely states its recommendations); others quote the abstract.
    const summary = (pmid: string) => (authored ? STUDIES.find(s => s.pmid === pmid)?.finding : undefined);
    const studies: Reference[] = articles.map((a, i) => ({ n: i + 1, id: `pmid:${a.pmid}`, kind: "study", design: a.kind, title: a.title, year: a.year, from: a.journal, text: summary(a.pmid) ?? a.conclusion, url: pubmedUrl({ pmid: a.pmid, query: a.title }), pmid: a.pmid }));
    const passages = await passagesFor(context, hospitalId, input.question);
    const references: Reference[] = [...studies, ...passages.map((p, i) => ({ n: studies.length + i + 1, kind: "library" as const, design: "Library" as const, ...p }))];

    let claims: Claim[], followUps: string[], source: string, waking: number | undefined;
    if (authored) {
      // Authored cites number the three rehearsed studies; renumber them to where each study landed, so a missing study drops its claims.
      const at = (n: number) => studies.findIndex(s => s.pmid === STUDIES[n - 1]?.pmid) + 1;
      claims = sourcedClaims(authored.claims.map(c => ({ text: c.text, cites: c.cites.map(at) })), studies.length);
      followUps = authored.followUps; source = "cached";
    } else {
      const read = await (context.models ?? stubModels).synthesiseEvidence({ question: input.question, thread: input.thread, sources: references.map(r => ({ n: r.n, design: r.design, year: r.year, title: r.title, text: r.text })) });
      claims = sourcedClaims(read.claims, references.length); followUps = read.followUps.slice(0, 3); source = read.source === "model" ? read.model : "fixture";
      // While Gemma is starting, the sample says in how many minutes.
      waking = read.source === "fixture" ? read.waking : undefined;
    }

    const rows = await db.select().from(observations).where(eq(observations.patientId, visit.patientId)).orderBy(asc(observations.observedAt));
    const curb65 = curb65FromObservations(rows as ObservationRow[], visit.age);

    await db.insert(provenance).values({ id: crypto.randomUUID(), encounterId: input.encounterId, kind: "evidence-answer", output: { question: input.question, claims }, sourceIds: references.map(r => r.id), model: source, approvedBy: null });
    return { question: input.question, claims, enough: claims.length > 0, followUps, source, ...waking ? { waking } : {}, references, pubmed, curb65 };
  }),
};
