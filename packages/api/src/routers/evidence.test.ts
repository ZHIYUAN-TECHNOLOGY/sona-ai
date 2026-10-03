import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { provenance, pubmedArticles } from "@sona-ai/db/schema/clinical";
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
/** Claims without their proof, to compare with the authored ones (their quotes are checked on their own). */
const bare = (claims: Claim[]) => claims.map(({ quotes: _, ...c }) => c);

test("the rehearsed steroid question: cited claims over its three PubMed studies, follow-ups, and Amelia's CURB-65 from her chart", async () => {
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

test("a suggested follow-up answers from its authored claims, offers the other two, and never searches PubMed afresh", async () => {
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
  // Daniel has no chart readings: only age counts, and the band is withheld.
  expect(r.curb65).toMatchObject({ recorded: 1, risk: undefined });
});

test("while Gemma is starting, the sample says in how many minutes it should answer", async () => {
  const models: Models = { ...stubModels, synthesiseEvidence: async input => ({ ...await stubModels.synthesiseEvidence(input), source: "fixture", waking: 12 }) };
  const { api } = await signedIn(pubmed(["25608756"]).fetcher, true, models);
  const r = await api.evidence.ask({ encounterId: "visit-1086", question: "Does prednisone shorten time to stability?" });
  expect(r).toMatchObject({ source: "fixture", waking: 12, enough: true });
  // The rehearsed question answers from authored content: no model, so nothing is starting.
  expect(await api.evidence.ask({ encounterId: "visit-1042", question: REHEARSED_Q })).not.toHaveProperty("waking");
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
  expect(seen).toMatchObject({ question: "What about the harms?", thread, sources: [{ n: 1, design: "Trial", year: 2015 }] });
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
  expect(searches[0]).toContain("(oseltamivir) AND (influenza) AND");
  expect(searches.some(u => /amelia|tan\b|syn-1042/i.test(u))).toBe(false);
  expect(r.references.map(s => s.pmid)).toEqual(["25608756"]);
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
