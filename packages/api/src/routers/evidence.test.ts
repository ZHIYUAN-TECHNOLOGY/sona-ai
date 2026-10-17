import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { provenance, pubmedArticles, pubmedSearches } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { ANSWER, BOTTOM_LINE, FOLLOW_UPS, STUDIES, type Claim } from "@sona-ai/domain/evidence";
import { eq } from "drizzle-orm";

import { stubModels, type Models } from "../models";
import { appRouter } from "./index";

const session = {
  user: { id: "dr-aisyah", name: "Dr Aisyah", email: "aisyah@demo.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: "s1", userId: "dr-aisyah", token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session;
// Real efetch output for the rehearsed question's three studies.
const efetch = readFileSync(new URL("../fixtures/pubmed-cap-steroids.xml", import.meta.url), "utf8");

/** PubMed as a fake: efetch serves the saved XML, esearch the given IDs; `down` makes every call fail. */
function pubmed(idlist = ["25608756"]) {
  const state = { down: false, calls: [] as string[] };
  const fetcher = (async (url: string) => {
    state.calls.push(String(url));
    if (state.down) throw new Error("network unreachable");
    return new Response(String(url).includes("esearch") ? JSON.stringify({ esearchresult: { idlist } }) : efetch);
  }) as unknown as typeof fetch;
  return { state, fetcher };
}

async function signedIn(fetcher: typeof fetch, signed = true, models?: Models) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  return { db, api: createRouterClient(appRouter, { context: { db, session: signed ? session : null, fetch: fetcher, models } }) };
}

const REHEARSED_Q = "Steroids for this patient with community-acquired pneumonia?";
/** A sentence from the findings of the prednisone trial's abstract (not its conclusion). */
const RARE_HARMS = "Other adverse events compatible with corticosteroid use were rare and similar in both groups.";
/** Claims without their proof, to compare with the authored ones (their quotes are checked on their own). */
const bare = (claims: Claim[]) => claims.map(({ quotes: _, ...c }) => c);

test("with no model configured, the rehearsed steroid question answers from authored content, labelled cached: cited claims over its three PubMed studies, follow-ups, and Amelia's CURB-65 from her chart", async () => {
  const { fetcher } = pubmed();
  const { api, db } = await signedIn(fetcher);
  const r = await api.evidence.ask({ encounterId: "visit-1042", question: REHEARSED_Q });
  expect(r.source).toBe("cached");
  expect(r.enough).toBe(true);
  expect(bare(r.claims)).toEqual(ANSWER);
  expect(r.bottomLine).toBe(BOTTOM_LINE);
  // Each claim's proof is the cited study's own reviewed sentence, so tapping its number shows what it rests on.
  expect(r.claims.map(c => c.quotes)).toEqual([[{ n: 1, text: STUDIES[0]!.finding }], [{ n: 3, text: STUDIES[2]!.finding }], [{ n: 2, text: STUDIES[1]!.finding }, { n: 1, text: STUDIES[0]!.finding }]]);
  expect(r.followUps).toEqual(FOLLOW_UPS.map(f => f.question));
  expect(r.references.map(s => [s.n, s.pmid, s.kind, s.design, s.year, s.from])).toEqual([[1, "31573350", "study", "Guideline", 2019, "Am J Respir Crit Care Med"], [2, "25608756", "study", "Trial", 2015, "Lancet"], [3, "36942789", "study", "Trial", 2023, "N Engl J Med"]]);
  // A guideline abstract rarely states its recommendations, so the rehearsed answer shows its summaries of each study.
  expect(r.references.map(s => s.text)).toEqual([STUDIES[0]!.finding, STUDIES[1]!.finding, STUDIES[2]!.finding]);
  expect(r.references[0]!.url).toBe("https://pubmed.ncbi.nlm.nih.gov/31573350/");
  expect(r).not.toHaveProperty("grade");
  expect(r.pubmed).toBe("live");
  expect(r.curb65).toMatchObject({ score: 0, recorded: 5, risk: "Low risk · home treatment is usually suitable" });
  expect(r.curb65.factors.find(f => f.id === "u")!.sources).toEqual(["obs-1042-urea"]);
  // The answer is logged with its claims and the sources it drew on.
  const [log] = await db.select().from(provenance);
  expect(log).toMatchObject({ encounterId: "visit-1042", kind: "evidence-answer", output: { question: REHEARSED_Q, claims: ANSWER }, sourceIds: ["pmid:31573350", "pmid:25608756", "pmid:36942789"], model: "cached" });
});

test("with no model configured, a suggested follow-up answers from its authored claims, offers the other two, and never searches PubMed afresh", async () => {
  const { state, fetcher } = pubmed();
  const { api } = await signedIn(fetcher);
  const follow = FOLLOW_UPS[1]!;
  const r = await api.evidence.ask({ encounterId: "visit-1042", question: follow.question, thread: [{ question: REHEARSED_Q, answer: ANSWER.map(c => c.text).join(" ") }] });
  expect({ source: r.source, enough: r.enough }).toEqual({ source: "cached", enough: true });
  expect(bare(r.claims)).toEqual(follow.claims);
  expect(r.followUps).toEqual([FOLLOW_UPS[0]!.question, FOLLOW_UPS[2]!.question]);
  expect(state.calls.some(u => u.includes("esearch"))).toBe(false);
});

test("when PubMed is down the studies come from the last fetch; never fetched means no references, no claims, and not enough evidence", async () => {
  const { state, fetcher } = pubmed();
  const { api, db } = await signedIn(fetcher);
  const question = "Should Amelia get corticosteroids for her pneumonia?";
  state.down = true;
  const cold = await api.evidence.ask({ encounterId: "visit-1042", question });
  expect(cold).toMatchObject({ pubmed: "unavailable", references: [], claims: [], enough: false });
  state.down = false;
  await api.evidence.ask({ encounterId: "visit-1042", question });
  expect(await db.select().from(pubmedArticles)).toHaveLength(3);
  state.down = true;
  const warm = await api.evidence.ask({ encounterId: "visit-1042", question });
  expect(warm.pubmed).toBe("cached");
  expect(warm.references.map(s => s.pmid)).toEqual(["31573350", "25608756", "36942789"]);
  expect(bare(warm.claims)).toEqual(ANSWER);
});

test("a missing study drops the authored claims that cite it, and the rest are renumbered to where their study landed", async () => {
  const { state, fetcher } = pubmed();
  const { api, db } = await signedIn(fetcher);
  await api.evidence.ask({ encounterId: "visit-1042", question: REHEARSED_Q });
  await db.delete(pubmedArticles).where(eq(pubmedArticles.pmid, "31573350"));
  state.down = true;
  const r = await api.evidence.ask({ encounterId: "visit-1042", question: REHEARSED_Q });
  expect(r.references.map(s => [s.n, s.pmid])).toEqual([[1, "25608756"], [2, "36942789"]]);
  // [1] (the guideline) is gone: its claim drops; [3] becomes [2]; [2, 1] keeps only the trial, now [1].
  expect(bare(r.claims)).toEqual([{ text: ANSWER[1]!.text, cites: [2], topic: "evidence" }, { text: ANSWER[2]!.text, cites: [1], topic: "harms" }]);
});

test("any other question searches PubMed, never borrows the authored answer, and shows the mock's cited claims as a sample", async () => {
  const { state, fetcher } = pubmed(["25608756"]);
  const { api } = await signedIn(fetcher);
  const r = await api.evidence.ask({ encounterId: "visit-1086", question: "Does prednisone shorten time to stability?" });
  expect(state.calls.some(u => u.includes("esearch") && u.includes("prednisone"))).toBe(true);
  expect(r.source).toBe("fixture");
  expect(r.references.map(s => [s.n, s.pmid, s.text.slice(0, 32)])).toEqual([[1, "25608756", "Prednisone treatment for 7 days "]]);
  // The mock quotes each source's first sentence; the route keeps it because the abstract says it word for word.
  expect(r.claims).toEqual([{ text: expect.stringMatching(/^A randomised trial \(2015\) reports: Prednisone treatment for 7 days/), cites: [1], topic: "evidence", quotes: [{ n: 1, text: expect.stringMatching(/^Prednisone treatment for 7 days/) }] }]);
  expect(r.followUps).toEqual(["What do the guidelines recommend?", "What are the main harms?", "Does this change for severe cases?"]);
  // Neither the question nor Daniel's visit (breathlessness) is pneumonia, so no pneumonia severity score comes with the answer.
  expect(r.curb65).toBeNull();
  // Following up a pneumonia question, it does. Daniel has no chart readings: only age counts, and the band is withheld.
  const followUp = await api.evidence.ask({ encounterId: "visit-1086", question: "Does prednisone shorten time to stability?", thread: [{ question: "Steroids for pneumonia?", answer: "Not routinely." }] });
  expect(followUp.curb65).toMatchObject({ recorded: 1, risk: undefined });
});

test("with a model configured the rehearsed question is searched and written like any other: PubMed is searched, the model writes from the abstracts, and nothing authored is used", async () => {
  const { state, fetcher } = pubmed(["25608756"]);
  let seen: Parameters<Models["synthesiseEvidence"]>[0] | undefined;
  const models: Models = { ...stubModels, synthesiseEvidence: async input => {
    seen = input;
    return { bottomLine: "It shortens time to stability.", claims: [{ text: "A randomised trial found prednisone shortened time to clinical stability.", cites: [2], topic: "evidence", quotes: [{ n: 2, text: RARE_HARMS }] }], followUps: ["At what dose?"], source: "model", model: "gemma-test" };
  } };
  const { api, db } = await signedIn(fetcher, true, models);
  const r = await api.evidence.ask({ encounterId: "visit-1042", question: REHEARSED_Q });
  expect(state.calls.some(u => u.includes("esearch") && u.includes("steroids"))).toBe(true);
  // The model read the study's whole abstract (not its conclusion alone, nor the authored summary), with its journal and PMID.
  const whole = /^BACKGROUND: Clinical trials yielded[\s\S]*\nFINDINGS: [\s\S]*3·0 days[\s\S]*\nINTERPRETATION: Prednisone treatment for 7 days[^\n]*$/;
  // Her own record is source 1, ahead of the study.
  expect(seen).toMatchObject({ question: REHEARSED_Q, sources: [{ n: 1, design: "Patient record" }, { n: 2, design: "Trial", year: 2015, from: "Lancet", pmid: "25608756", text: expect.stringMatching(whole) }] });
  expect({ source: r.source, enough: r.enough, bottomLine: r.bottomLine, followUps: r.followUps }).toEqual({ source: "gemma-test", enough: true, bottomLine: "It shortens time to stability.", followUps: ["At what dose?"] });
  expect(bare(r.claims)).toEqual([{ text: "A randomised trial found prednisone shortened time to clinical stability.", cites: [2], topic: "evidence" }]);
  // Its quote is from the abstract's findings: kept, because the abstract says it, while the source card still shows the conclusion.
  expect(r.claims[0]!.quotes).toEqual([{ n: 2, text: RARE_HARMS }]);
  expect(r.references[1]!.text).toStartWith("Prednisone treatment for 7 days");
  // With PubMed down, the saved copy is the whole abstract too.
  state.down = true;
  const offline = await api.evidence.ask({ encounterId: "visit-1042", question: REHEARSED_Q });
  expect([offline.pubmed, offline.references[1]!.text.slice(0, 31), offline.claims[0]!.quotes]).toEqual(["cached", "Prednisone treatment for 7 days", [{ n: 2, text: RARE_HARMS }]]);
  expect(seen!.sources[1]!.text).toMatch(whole);
  state.down = false;
  expect(r.references.filter(s => s.kind === "study").map(s => [s.pmid, s.text === STUDIES[1]!.finding])).toEqual([["25608756", false]]);
  expect((await db.select().from(provenance))[0]).toMatchObject({ model: "gemma-test" });
  // A suggested follow-up, word for word, is the model's too; and the stream says it is being written.
  expect((await api.evidence.ask({ encounterId: "visit-1042", question: FOLLOW_UPS[1]!.question, thread: [{ question: REHEARSED_Q, answer: "" }] })).source).toBe("gemma-test");
  const steps = [];
  for await (const event of await api.evidence.stream({ encounterId: "visit-1042", question: REHEARSED_Q })) steps.push(event.type === "step" ? event.step : event.type);
  expect(steps).toEqual(["search", "read", "write", "answer"]);
});

test("a configured model that does not answer is said as that: no claims, no authored or sample text, and while its box starts, in how many minutes to ask again", async () => {
  // What the hosted adapter returns when Gemma's box is starting or its call failed: the stub's sample, labelled fixture.
  const models: Models = { ...stubModels, synthesiseEvidence: async input => ({ ...await stubModels.synthesiseEvidence(input), source: "fixture", waking: 12 }) };
  const { api, db } = await signedIn(pubmed(["25608756"]).fetcher, true, models);
  for (const question of [REHEARSED_Q, "Does prednisone shorten time to stability?"]) {
    const r = await api.evidence.ask({ encounterId: "visit-1042", question });
    expect(r).toMatchObject({ source: "fixture", waking: 12, enough: false, claims: [], followUps: [], references: [{ kind: "record" }, { pmid: "25608756" }] });
    expect([r.bottomLine, r.general]).toEqual([undefined, undefined]);
  }
  expect((await db.select().from(provenance)).map(p => p.model)).toEqual(["fixture", "fixture"]);
  // The same when the answer streams and the stream gives up: nothing written is shown as the answer.
  const streaming: Models = { ...models, async *streamEvidence(input) { return await models.synthesiseEvidence(input); } };
  const failed = await (await signedIn(pubmed(["25608756"]).fetcher, true, streaming)).api.evidence.ask({ question: REHEARSED_Q });
  expect(failed).toMatchObject({ source: "fixture", waking: 12, enough: false, claims: [] });
});

test("a search that found nothing is searched again the next time, not reused for a week", async () => {
  const idlist: string[] = [];
  const { state, fetcher } = pubmed(idlist);
  const { api } = await signedIn(fetcher);
  const question = "Does prednisone shorten time to stability?";
  expect((await api.evidence.ask({ question })).references).toEqual([]);
  idlist.push("25608756");
  state.calls.length = 0;
  expect((await api.evidence.ask({ question })).references.map(r => r.pmid)).toEqual(["25608756"]);
  expect(state.calls.some(u => u.includes("esearch"))).toBe(true);
});

test("a model's uncited or out-of-range claims are all dropped, leaving not enough evidence; the thread reaches the model", async () => {
  const { fetcher } = pubmed(["25608756"]);
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  let seen: unknown;
  const models = { ...stubModels, synthesiseEvidence: async (input: Parameters<typeof stubModels.synthesiseEvidence>[0]) => {
    seen = input;
    return { claims: [{ text: "No citation at all.", cites: [] }, { text: "Cites a source that is not there.", cites: [7] }], followUps: ["a", "b", "c", "d"], source: "model" as const, model: "gemma-test" };
  } };
  const api = createRouterClient(appRouter, { context: { db, session, fetch: fetcher, models } });
  const thread = [{ question: "Is prednisone useful here?", answer: "A randomised trial found stability a day sooner." }];
  const r = await api.evidence.ask({ encounterId: "visit-1086", question: "What about the harms?", thread });
  expect({ claims: r.claims, enough: r.enough, source: r.source, followUps: r.followUps }).toEqual({ claims: [], enough: false, source: "gemma-test", followUps: ["a", "b", "c"] });
  expect(seen).toMatchObject({ question: "What about the harms?", thread, sources: [{ n: 1, design: "Patient record" }, { n: 2, design: "Trial", year: 2015 }] });
});

test("no source answers it: Gemma's general answer comes back instead, and only when no claim survives", async () => {
  const { fetcher } = pubmed(["25608756"]);
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  let claims = [{ text: "Cites a source that is not there.", cites: [7] }];
  const models = { ...stubModels, synthesiseEvidence: async () => ({ claims, followUps: [], general: "Hand hygiene is the main defence.", source: "model" as const, model: "gemma-test" }) };
  const api = createRouterClient(appRouter, { context: { db, session, fetch: fetcher, models } });
  expect(await api.evidence.ask({ encounterId: "visit-1086", question: "How do I stop a ward outbreak?" })).toMatchObject({ claims: [], enough: false, general: "Hand hygiene is the main defence." });
  claims = [{ text: "A randomised trial found stability a day sooner.", cites: [1] }];
  expect((await api.evidence.ask({ encounterId: "visit-1086", question: "Is prednisone useful here?" })).general).toBeUndefined();
});

test("a question asked again within the week skips PubMed's search (its articles are still fetched), has its studies when PubMed is down, and searches again once a week old", async () => {
  const { state, fetcher } = pubmed(["25608756"]);
  const { api, db } = await signedIn(fetcher);
  const question = "Does prednisone shorten time to stability?";
  const searches = () => state.calls.filter(u => u.includes("esearch")).length;
  await api.evidence.ask({ encounterId: "visit-1086", question });
  const searched = searches();
  expect(await api.evidence.ask({ encounterId: "visit-1086", question })).toMatchObject({ pubmed: "live", references: [{ pmid: "25608756" }] });
  expect(searches()).toBe(searched);
  state.down = true;
  expect(await api.evidence.ask({ encounterId: "visit-1086", question })).toMatchObject({ pubmed: "cached", references: [{ pmid: "25608756" }] });
  state.down = false;
  await db.update(pubmedSearches).set({ searchedAt: new Date(Date.now() - 8 * 86400_000) });
  await api.evidence.ask({ encounterId: "visit-1086", question });
  expect(searches()).toBeGreaterThan(searched);
});

test("a search saved before PubMed's query changed is never reused: the question is searched again the new way", async () => {
  // Staging, 8 Oct: after title-and-abstract search shipped, the IDs saved that afternoon for the same key terms (a
  // rhinosinusitis guideline, an Acinetobacter trial) kept answering "pneumonia with a penicillin allergy" for a week.
  const { state, fetcher } = pubmed(["25608756"]);
  const { api, db } = await signedIn(fetcher);
  await db.insert(pubmedSearches).values({ terms: "pneumonia AND penicillin allergy", pmids: ["14726904", "37182534"] });
  const r = await api.evidence.ask({ question: "What does the evidence say for pneumonia with a penicillin allergy?" });
  expect(decodeURIComponent(state.calls.find(u => u.includes("esearch")) ?? "")).toContain("(pneumonia[tiab]) AND (penicillin[tiab] AND allergy[tiab])");
  expect(r.references.map(x => x.pmid)).toEqual(["25608756"]);
});

test("the library is searched while PubMed is, not after it", async () => {
  let libraryAsked!: () => void;
  const asked = new Promise<void>(resolve => { libraryAsked = resolve; });
  const { fetcher } = pubmed(["25608756"]);
  // PubMed answers only once the library was asked: searched one after the other, this would never finish.
  const waiting = (async (url: string) => { await asked; return fetcher(url); }) as unknown as typeof fetch;
  const library = { search: async () => { libraryAsked(); return []; }, ingest: async () => 0, reindex: async () => 0 };
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  const api = createRouterClient(appRouter, { context: { db, session, fetch: waiting, library } });
  expect((await api.evidence.ask({ question: "Does prednisone shorten time to stability?" })).references.map(r => r.pmid)).toEqual(["25608756"]);
});

test("a search that fell back and an answer that was cut short are said in the answer, never passed off as the usual", async () => {
  const hit = { chunkId: "c1", documentId: "ward-protocol", sourceId: "ward-protocol#steroids", text: "Check glucose daily on steroids.", score: 0.03, tags: { source: "Ward protocol", year: 2024, section: "Steroids" } };
  // packages/retrieval's search: the embedder failed (keywords alone) and so did the reranker (the fused order stands).
  let hits: (typeof hit)[] = Object.assign([hit], { retrieval: "keywords", ranked: false });
  const library = { search: async () => hits, ingest: async () => 0, reindex: async () => 0 };
  let cutShort: boolean | undefined = true;
  const models = { ...stubModels, synthesiseEvidence: async () => ({ claims: [{ text: "The ward protocol checks glucose daily.", cites: [2] }], followUps: [], cutShort, source: "model" as const, model: "gemma-test" }) };
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  const api = createRouterClient(appRouter, { context: { db, session, fetch: pubmed(["25608756"]).fetcher, library, models } });
  const r = await api.evidence.ask({ question: "Glucose checks on prednisone?" });
  // The passage is real, so it is still a source and its claim stands.
  expect(r).toMatchObject({ retrieval: "keywords", ranked: false, cutShort: true, enough: true, claims: [{ cites: [2] }], references: [{ pmid: "25608756" }, { kind: "library" }] });
  // Nothing fell back and the answer was whole: nothing is said.
  hits = Object.assign([hit], { retrieval: "hybrid", ranked: true }); cutShort = undefined;
  const usual = await api.evidence.ask({ question: "Glucose checks on prednisone?" });
  expect(usual).toMatchObject({ retrieval: "hybrid", ranked: true });
  expect("cutShort" in usual).toBe(false);
});

test("PubMed is searched by the question's key terms, never the patient's name or record number, and an article without an abstract is not a source", async () => {
  const calls: string[] = [];
  // esearch finds an abstract-less article (111) before a real one; efetch returns both.
  const noAbstract = `<PubmedArticle><MedlineCitation><PMID Version="1">111</PMID><Article><Journal><ISOAbbreviation>J Test</ISOAbbreviation><JournalIssue><PubDate><Year>2020</Year></PubDate></JournalIssue></Journal><ArticleTitle>Editorial without an abstract.</ArticleTitle></Article></MedlineCitation></PubmedArticle>`;
  const fetcher = (async (url: string) => {
    calls.push(decodeURIComponent(String(url)));
    return new Response(String(url).includes("esearch") ? JSON.stringify({ esearchresult: { idlist: ["111", "25608756"] } }) : efetch.replace("</PubmedArticleSet>", `${noAbstract}</PubmedArticleSet>`));
  }) as unknown as typeof fetch;
  const { api } = await signedIn(fetcher);
  const r = await api.evidence.ask({ encounterId: "visit-1042", question: "Should Amelia Tan (SYN-1042) get oseltamivir for her influenza?" });
  const searches = calls.filter(u => u.includes("esearch"));
  expect(searches[0]).toContain("(oseltamivir[tiab]) AND (influenza[tiab]) AND");
  expect(searches.some(u => /amelia|tan\b|syn-1042/i.test(u))).toBe(false);
  expect(r.references.map(s => s.pmid)).toEqual(["25608756"]);
});

test("asked in a visit, the model reads that patient's record without their name or record number and says what bears on them; a point naming an unrecorded fact is dropped; asked anywhere else there is no patient", async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(decodeURIComponent(String(url)));
    return new Response(String(url).includes("esearch") ? JSON.stringify({ esearchresult: { idlist: ["25608756"] } }) : efetch);
  }) as unknown as typeof fetch;
  const seen: Parameters<Models["synthesiseEvidence"]>[0][] = [];
  const models: Models = { ...stubModels, synthesiseEvidence: async input => {
    seen.push(input);
    return { claims: [{ text: "A randomised trial found prednisone shortened time to clinical stability.", cites: [1], topic: "evidence" }], followUps: [], source: "model", model: "gemma-test", patientPoints: [
      { text: "She has a recorded penicillin allergy, so a penicillin is not an option alongside it.", cites: [1], fact: "Penicillin — reported rash" },
      { text: "Her kidney function is poor, so the dose needs lowering.", cites: [1], fact: "eGFR 28 mL/min" },
      { text: "Her asthma is recorded.", cites: [9], fact: "Asthma since childhood" },
    ] };
  } };
  const { api, db } = await signedIn(fetcher, true, models);
  const question = "Should Amelia Tan (SYN-1042) get prednisone for her pneumonia?";
  const r = await api.evidence.ask({ encounterId: "visit-1042", question, thread: [{ question: "Is Amelia's pneumonia severe?", answer: "Amelia Tan scores CURB-65 0." }] });
  // Her record as the rows hold it: age and sex, history, allergy, medicines, the chart's latest readings (urea among them).
  const record = seen[0]!.patient!;
  for (const fact of ["Age 42, female. Came in with: Cough for five days", "History: Asthma since childhood", "Allergies: Penicillin — reported rash", "Medicines before admission: Salbutamol inhaler", "Urea 5.1 mmol/L", "Oxygen saturation 97 %"]) expect(record).toContain(fact);
  // Nothing the model reads names her: not her record, not the doctor's question, not the thread. Nor do PubMed's terms.
  expect(JSON.stringify(seen[0])).not.toMatch(/amelia|\btan\b|syn-1042/i);
  expect(seen[0]!.question).toBe("Should [NAME] ([MRN]) get prednisone for her pneumonia?");
  expect(calls.some(u => u.includes("esearch") && u.includes("prednisone"))).toBe(true);
  expect(calls.some(u => /amelia|tan\b|syn-1042/i.test(u))).toBe(false);
  // The recorded allergy stands, citing its source and the record's own words; the unrecorded kidney function and the point citing no source are dropped.
  expect(r.patientPoints).toEqual([{ text: "She has a recorded penicillin allergy, so a penicillin is not an option alongside it.", cites: [1], fact: "Penicillin — reported rash" }]);
  expect(r.claims.map(c => c.cites)).toEqual([[1]]);
  expect((await db.select().from(provenance)).at(-1)!.output).toMatchObject({ patientPoints: r.patientPoints });
  // Another visit's patient is read from her own rows only (her low potassium, not Amelia's allergy).
  await api.evidence.ask({ encounterId: "visit-1086", question });
  expect(seen[1]!.patient).toContain("- Potassium 3.1 mmol/L, low");
  expect(seen[1]!.patient).not.toContain("Penicillin — reported rash");
  // Asked outside a visit: no record goes to the model, and nothing about a patient comes back, whatever the model wrote.
  const anywhere = await api.evidence.ask({ question });
  expect(seen[2]!.patient).toBeUndefined();
  expect(anywhere).not.toHaveProperty("patientPoints");
});

test("evidence needs a login", async () => {
  const { api } = await signedIn(pubmed().fetcher, false);
  expect(api.evidence.ask({ encounterId: "visit-1042", question: "Steroids?" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

test("the stream shows each step as it happens (search, read, then write for a model's answer) and ends with the answer; asked off a visit there is no patient", async () => {
  const { fetcher } = pubmed();
  const { api } = await signedIn(fetcher);
  const events = [];
  for await (const event of await api.evidence.stream({ encounterId: "visit-1042", question: REHEARSED_Q })) events.push(event);
  // The rehearsed answer is authored, so nothing is written: search, read, answer.
  expect(events.map(e => e.type === "step" ? e.step : e.type)).toEqual(["search", "read", "answer"]);
  expect(events[1]).toMatchObject({ type: "step", step: "read", studies: 3, passages: 0 });
  expect(events[1]!.type === "step" && events[1]!.step === "read" && events[1]!.references.map(r => r.pmid)).toEqual(["31573350", "25608756", "36942789"]);
  const last = events.at(-1)!;
  expect(last.type === "answer" && last.answer.bottomLine).toBe(BOTTOM_LINE);

  const steps = [];
  for await (const event of await api.evidence.stream({ question: "Does azithromycin prolong the QT interval?" })) steps.push(event.type === "step" ? event.step : event.type);
  expect(steps).toEqual(["search", "read", "write", "answer"]);
  // A question asked anywhere else has no patient: no CURB-65, and nothing of a patient's kept out of the search.
  const anywhere = await api.evidence.ask({ question: REHEARSED_Q });
  expect({ curb65: anywhere.curb65, enough: anywhere.enough, bottomLine: anywhere.bottomLine }).toEqual({ curb65: null, enough: true, bottomLine: BOTTOM_LINE });
});

test("a model's answer streams part by part, each claim checked as it arrives: one citing no source is dropped, an invented quote never shows", async () => {
  const { fetcher } = pubmed(["25608756"]);
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  const models = { ...stubModels, async *streamEvidence() {
    yield { bottomLine: "Prednisone shortens time to stability." };
    yield { claim: { text: "Cites a source that is not there.", cites: [9] } };
    yield { claim: { text: "Prednisone shortened time to stability.", cites: [1], quotes: [{ n: 1, text: "An invented sentence that no abstract says." }] } };
    return { claims: [{ text: "Prednisone shortened time to stability.", cites: [1] }], followUps: [], bottomLine: "Prednisone shortens time to stability.", source: "model" as const, model: "gemma-test" };
  } };
  const api = createRouterClient(appRouter, { context: { db, session, fetch: fetcher, models } });
  const events = [];
  for await (const event of await api.evidence.stream({ encounterId: "visit-1086", question: "What about prednisone?" })) events.push(event);
  expect(events.map(e => e.type === "step" ? e.step : e.type)).toEqual(["search", "read", "write", "bottomLine", "claim", "answer"]);
  const claim = events[4]!.type === "claim" ? events[4]!.claim : undefined;
  expect(claim).toMatchObject({ text: "Prednisone shortened time to stability.", cites: [1] });
  expect(claim?.quotes?.some(q => q.text.startsWith("An invented"))).toBeFalsy();
});

test("in a visit her own record is a numbered source: a question about her is answered and cited from it, with the visit's saved note, and her name never reaches the model", async () => {
  // No study fits "brief me": PubMed finds nothing, so her record is the only source.
  const { fetcher } = pubmed([]);
  let seen: Parameters<Models["synthesiseEvidence"]>[0] | undefined;
  const models: Models = { ...stubModels, synthesiseEvidence: async input => {
    seen = input;
    return { bottomLine: "A teacher with asthma and a penicillin allergy, seen for possible pneumonia.", claims: [{ text: "Her consultation suspects community-acquired pneumonia.", cites: [1], topic: "evidence", quotes: [{ n: 1, text: "possible community-acquired pneumonia." }] }], followUps: [], source: "model", model: "gemma-test" };
  } };
  const { api } = await signedIn(fetcher, true, models);
  await api.note.save({ encounterId: "visit-1042", expectedRevision: 0, sentences: [{ id: "assessment", text: "Amelia Tan: possible community-acquired pneumonia." }, { id: "plan", text: "Chest X-ray today." }] });
  const r = await api.evidence.ask({ encounterId: "visit-1042", question: "Brief me on Amelia" });
  expect(r.references.map(s => [s.n, s.kind, s.title])).toEqual([[1, "record", "Patient record"]]);
  expect({ enough: r.enough, cites: r.claims.map(c => c.cites), general: r.general }).toEqual({ enough: true, cites: [[1]], general: undefined });
  // What she came with, her allergy and this visit's note, by facts, never by name.
  const record = seen!.sources[0]!;
  expect(record).toMatchObject({ n: 1, design: "Patient record" });
  for (const fact of ["Came in with: Cough for five days", "Allergies: Penicillin", "Doctor's note for this visit", "possible community-acquired pneumonia. Chest X-ray today."]) expect(record.text).toContain(fact);
  expect(`${record.text} ${seen!.question}`).not.toContain("Amelia");
  expect(seen!.patient).toBe(record.text);
  // Asked off a visit there is no record to cite.
  expect((await api.evidence.ask({ question: "Brief me on Amelia" })).references).toEqual([]);
});

test("in a visit her record also says her stay, as the ward and the discharge card hold it: the bed, fit to go since when, the ward's handover and the take-home medicines (10 Oct, gate: \"not on any antibiotics\" for a patient going home on azithromycin)", async () => {
  let seen: Parameters<Models["synthesiseEvidence"]>[0] | undefined;
  const models: Models = { ...stubModels, synthesiseEvidence: async input => { seen = input; return stubModels.synthesiseEvidence(input); } };
  const { api } = await signedIn(pubmed([]).fetcher, true, models);
  await api.evidence.ask({ encounterId: "visit-1042", question: "What antibiotic is she on?" });
  for (const line of ["Stay: Bed 6, on the ward, fit for discharge since Sat, 26 Sep 2026 08:00", "Ward handover (SBAR): Situation: Community-acquired pneumonia, mild, day 2.", "Recommendation: Discharge today on oral azithromycin.",
    "Take-home medicines (charted, not yet confirmed):", "- Azithromycin (changed): IV 500 mg to oral 500 mg daily, 2 more days"]) expect(seen!.patient).toContain(line);
  await api.discharge.update({ encounterId: "visit-1042", medsConfirmed: true });
  await api.evidence.ask({ encounterId: "visit-1042", question: "What antibiotic is she on?" });
  expect(seen!.patient).toContain("Take-home medicines (confirmed by the doctor):");
  // Daniel was never admitted: no stay.
  await api.evidence.ask({ encounterId: "visit-1086", question: "What is he on?" });
  expect(seen!.patient).not.toContain("Stay:");
});
