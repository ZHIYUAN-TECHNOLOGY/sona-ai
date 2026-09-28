import { documents, encounters, observations, patients, provenance, pubmedArticles } from "@sona-ai/db/schema/clinical";
import { ANSWER, GRADE, STUDIES, certaintyOf, curb65FromObservations, pubmedUrl, studyKind, type ObservationRow, type StudyKind } from "@sona-ai/domain/evidence";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { Context } from "../context";
import { stubModels } from "../models";
import { protectedProcedure } from "../index";
import { fetchArticles, searchPubmed, type Article } from "../pubmed";

/**
 * Flow 4, the evidence answer: PubMed studies behind the question, a certainty label by rule on
 * their designs, and the patient's CURB-65 from recorded readings. The rehearsed demo question
 * answers from a cache so the stage cannot fail on the network or a cold model; anything else gets
 * the model's synthesis (a labelled fixture until the models are on). Fetched articles are cached,
 * so a question asked once still has its sources when PubMed is unreachable.
 */
const REHEARSED = {
  matches: (q: string) => /steroid|prednis|hydrocortisone/i.test(q) && /pneumonia|\bCAP\b/i.test(q),
  // Checked against PubMed: ATS/IDSA 2019 guideline, Blum 2015 (Lancet), CAPE COD 2023 (NEJM).
  pmids: ["31573350", "25608756", "36942789"],
};
const DESIGNS: Record<StudyKind, string> = { Guideline: "guideline", Review: "systematic review", Trial: "randomised trial", "Narrative review": "narrative review", Study: "other studies" };
const RANK: StudyKind[] = ["Guideline", "Review", "Trial", "Narrative review", "Study"];

type Cached = typeof pubmedArticles.$inferSelect;
const fromCache = (r: Cached): Article => ({ pmid: r.pmid, title: r.title, journal: r.journal, year: r.year, publicationTypes: r.publicationTypes, kind: studyKind(r.publicationTypes), conclusion: r.conclusion });

/** The articles, live from PubMed (and cached) when it answers, else from the cache. */
async function articlesFor(db: Context["db"], fetcher: typeof fetch, question: string, rehearsed: boolean) {
  try {
    const pmids = rehearsed ? REHEARSED.pmids : await searchPubmed(`(${question}) AND (guideline[pt] OR systematic review[pt] OR randomized controlled trial[pt])`, fetcher, 3);
    const articles = await fetchArticles(pmids, fetcher);
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
 * Up to three passages from the library (the shared guidelines and the hospital's own uploads) for
 * the question, each with its document title and section. They are cited, never graded: certainty
 * stays a rule on the PubMed study designs.
 * ponytail: the nearest passages come back with no relevance floor; add a reranker score floor when bge-reranker is on.
 */
async function passagesFor(context: Context, hospitalId: string, question: string) {
  const hits = context.library ? await context.library.search({ query: question, hospitalId, userId: context.session?.user.id, k: 3 }) : [];
  if (!hits.length) return [];
  const docs = await context.db.select({ id: documents.id, title: documents.title }).from(documents).where(inArray(documents.id, hits.map(h => h.documentId)));
  const title = new Map(docs.map(d => [d.id, d.title]));
  return hits.map(h => ({ id: h.sourceId, documentId: h.documentId, title: title.get(h.documentId) ?? h.tags.source, section: h.tags.section, source: h.tags.source, year: h.tags.year, text: h.text }));
}

export const evidenceRouter = {
  ask: protectedProcedure.input(z.object({ encounterId: z.string().min(1), question: z.string().trim().min(1).max(500) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const [visit] = await db.select({ patientId: patients.id, age: patients.age }).from(encounters).innerJoin(patients, eq(patients.id, encounters.patientId))
      .where(and(eq(encounters.id, input.encounterId), eq(encounters.hospitalId, hospitalId)));
    if (!visit) throw new ORPCError("NOT_FOUND", { message: `No encounter ${input.encounterId}` });

    const rehearsed = REHEARSED.matches(input.question);
    const { articles, pubmed } = await articlesFor(db, context.fetch ?? fetch, input.question, rehearsed);
    // The rehearsed answer shows its reviewed summary of each study (a guideline's abstract rarely states its recommendations); others quote the abstract.
    const summary = (pmid: string) => (rehearsed ? STUDIES.find(s => s.pmid === pmid)?.finding : undefined);
    const studies = articles.map(a => ({ id: `pmid:${a.pmid}`, pmid: a.pmid, kind: a.kind, year: a.year, title: a.title, journal: a.journal, finding: summary(a.pmid) ?? a.conclusion, query: a.title, url: pubmedUrl({ pmid: a.pmid, query: a.title }) }));
    const passages = await passagesFor(context, hospitalId, input.question);
    const strongest = RANK.find(k => studies.some(s => s.kind === k));
    const grade = { certainty: certaintyOf(studies.map(s => s.kind)), ...(strongest ? { rule: `Strongest design cited: ${DESIGNS[strongest]}` } : {}) };

    let answer: string[], source: string;
    if (rehearsed) { answer = ANSWER; source = "cached"; Object.assign(grade, { direction: GRADE.direction, scope: GRADE.scope }); }
    else {
      const read = await (context.models ?? stubModels).synthesiseEvidence({ question: input.question, studies });
      answer = [read.answer]; source = read.source === "model" ? read.model : "fixture";
    }

    const rows = await db.select().from(observations).where(eq(observations.patientId, visit.patientId)).orderBy(asc(observations.observedAt));
    const curb65 = curb65FromObservations(rows as ObservationRow[], visit.age);

    await db.insert(provenance).values({ id: crypto.randomUUID(), encounterId: input.encounterId, kind: "evidence-answer", output: { question: input.question, answer, grade }, sourceIds: [...studies.map(s => s.id), ...passages.map(p => p.id)], model: source, approvedBy: null });
    return { question: input.question, answer, source, grade: grade as { certainty: string; rule?: string; direction?: string; scope?: string }, studies, passages, pubmed, curb65 };
  }),
};
