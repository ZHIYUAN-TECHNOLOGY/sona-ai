import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { DEMO_HOSPITAL } from "@sona-ai/db/demo";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import { chatModels, type Chat } from "./chat-models";
import type { Library } from "./context";
import type { RetrievalHit, SearchInput } from "./contracts";
import { PASSAGES_MS, citedSources, leafletHits, passagesIn } from "./leaflets";
import { stubModels, type Models } from "./models";
import { appRouter } from "./routers/index";
import { LINES, answerTurn, type ChatMessage, type ChatStream, type TurnSummary } from "./voice-agent/answer";

/**
 * The hospital's leaflets behind a Sona Care answer, with the library faked (packages/retrieval's own tests search a
 * real one and hold the scoping): what Gemma is shown, what comes back as `sources`, and that neither a slow or failed
 * search nor the leaflets themselves move the 999 line or the care team's report.
 */
const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

const hit = (leaflet: string, language: string, title: string, text: string): RetrievalHit => ({
  chunkId: `${leaflet}:${language}#c`, documentId: `demo:leaflet:${leaflet}:${language}`, sourceId: `${leaflet}:${language}#c`, text, score: 1,
  tags: { source: "Patient leaflet", year: 2026, section: "Community-acquired pneumonia", title },
});
const CHEST = hit("pneumonia", "en", "Chest infection", "Finish your antibiotic course as prescribed. Come back straight away if breathing gets harder.");
const HOME = hit("going-home", "en", "Going home from hospital", "Take your medicines as listed on your take-home sheet.");
const library = (search: (input: SearchInput) => Promise<RetrievalHit[]>): Library => ({ search, ingest: async () => 0, reindex: async () => 0 });

/** Amelia, joined (still in hospital: her plan's language is English), asking through the real route with Gemma faked. */
async function world(chat: Chat, lib?: Library, models: Partial<Models> = {}) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await addClinician(db, "dr-aisyah");
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), library: lib, models: { ...stubModels, ...chatModels(chat, "gemma-test", stubModels), ...models } } });
  const amelia = as("amelia-account");
  await amelia.care.join({ code: (await as("dr-aisyah").care.code({ encounterId: "visit-1042" })).code });
  return { amelia, doctor: as("dr-aisyah") };
}

test("a typed question: the leaflets found reach Gemma under their own heading, after her record and numbered, and the ones it cites come back as sources", async () => {
  const prompts: string[] = [], searched: SearchInput[] = [];
  const chat: Chat = async system => { prompts.push(system); return { answer: "The hospital's leaflet says to finish your antibiotics [1].", grounded: false, urgent: false, cites: [1, 7, "2"] }; };
  const { amelia } = await world(chat, library(async input => { searched.push(input); return [CHEST, HOME]; }));
  const answer = await amelia.care.ask({ question: "What should I watch for while recovering from pneumonia?" });
  // The search is the patient's own: her hospital, patient leaflets only, and no account of hers passed as a doctor's.
  expect(searched).toEqual([{ query: "What should I watch for while recovering from pneumonia?", hospitalId: DEMO_HOSPITAL, patient: true, k: 9 }]);
  const [prompt] = prompts;
  expect(prompt).toContain("\n\nHospital's general leaflets (advice for any patient, not facts about this patient):\n[1] Chest infection: Finish your antibiotic course as prescribed.");
  expect(prompt).toContain("\n[2] Going home from hospital: Take your medicines as listed on your take-home sheet.");
  expect(prompt!.indexOf("Patient's record:")).toBeLessThan(prompt!.indexOf("Hospital's general leaflets"));
  // Honest about her record, and never only "ask your care team" (founder, 9 Oct).
  expect(prompt).toContain("Never say something is in their record when it is not, and never invent a fact about them");
  expect(prompt).toContain('never answer or end with "ask your doctor or care team" instead of the answer itself');
  // 7 was never offered and "2" is not a number: neither names a source. The number is not shown in the answer.
  expect(answer).toEqual({ answer: "The hospital's leaflet says to finish your antibiotics.", grounded: false, urgent: false, sources: [{ title: "Chest infection", kind: "leaflet" }], withheld: 0, source: "model", model: "gemma-test" });
});

test("a search that is late, fails, or has no library still answers as before, with no sources and none offered", async () => {
  const prompts: string[] = [];
  const chat: Chat = async system => { prompts.push(system); return { answer: "In general, rest and drink plenty of water.", grounded: false, urgent: false, cites: [1] }; };
  const expected = { answer: "In general, rest and drink plenty of water.", grounded: false, urgent: false, sources: [], withheld: 0, source: "model", model: "gemma-test" };
  const failed = await world(chat, library(async () => { throw new Error("embedder and database down"); }));
  expect(await failed.amelia.care.ask({ question: "How do I recover faster?" })).toEqual(expected);
  const none = await world(chat);
  expect(await none.amelia.care.ask({ question: "How do I recover faster?" })).toEqual(expected);
  const late = await world(chat, library(() => new Promise(() => {})));
  const from = Date.now();
  expect(await late.amelia.care.ask({ question: "How do I recover faster?" })).toEqual(expected);
  expect(Date.now() - from).toBeLessThan(PASSAGES_MS + 1500);
  for (const prompt of prompts) expect(prompt).toEndWith("Hospital's general leaflets (advice for any patient, not facts about this patient):\nNone found for this question.");
  // On its own: late is none, in PASSAGES_MS, and a search that throws before it starts is none too.
  expect(await leafletHits(library(() => new Promise(() => {})), "demo", "anything")).toEqual([]);
  expect(await leafletHits(library(() => { throw new Error("no"); }), "demo", "anything")).toEqual([]);
});

test("the gates fire first: an emergency sign reaches the care team while the leaflets are still being searched, before Gemma is asked", async () => {
  const order: string[] = [];
  let found!: (hits: RetrievalHit[]) => void;
  const lib = library(() => new Promise(resolve => { found = resolve; }));
  const chat: Chat = async () => { order.push("gemma asked"); return { answer: "Call 999 now.", grounded: false, urgent: true, cites: [] }; };
  const { amelia, doctor } = await world(chat, lib, { classifyReply: async () => { order.push("care team's reader"); setTimeout(() => { order.push("leaflets found"); found([CHEST]); }, 50); return { label: "urgent", symptom: "Chest pain", source: "model", model: "gemma-test" }; } });
  const answer = await amelia.care.ask({ question: "Sakit dada dan sesak nafas" });
  expect(order).toEqual(["care team's reader", "leaflets found", "gemma asked"]);
  expect(answer).toMatchObject({ urgent: true, sources: [], careTeam: { title: "Amelia: chest pain", line: LINES.en.told } });
  expect((await doctor.tasks.list()).some(t => t.title === "Amelia: chest pain")).toBe(true);
});

/** A call's Gemma writing `reply`, noting what it was shown. */
function gemma(reply: string) {
  const log = { messages: [] as ChatMessage[] };
  const chat: ChatStream = async messages => { log.messages = messages; return { model: "gemma-test", text: (async function* () { yield reply; })() }; };
  return { chat, log };
}

test("a spoken question: the 999 line is said before the leaflets are in, Gemma reads them under their heading, and its cites are sources, never words", async () => {
  let found!: (passages: RetrievalHit[]) => void;
  const hits = new Promise<RetrievalHit[]>(resolve => { found = resolve; });
  const { chat, log } = gemma('{"triage":"urgent","inPlan":false,"cites":[1,4]}\nThe hospital\'s leaflet [1] says to come back if breathing gets harder. Rest today.');
  const summaries: TurnSummary[] = [], escalated: string[] = [];
  const parts = answerTurn({
    question: "I have chest pain, what should I watch for?", history: [], plan: "Medicines: none", language: "en", signal: new AbortController().signal, chat,
    passages: hits.then(h => passagesIn(h, "en")), escalate: async label => { escalated.push(label); return true; }, done: s => summaries.push(s),
  });
  // The keyword floor: said while the search is still out and before Gemma has been asked at all.
  expect((await parts.next()).value).toEqual({ type: "text-delta", text: LINES.en.call999 });
  expect(log.messages).toEqual([]);
  found([CHEST, HOME]);
  const said: string[] = [];
  for await (const part of parts) if (part.type === "text-delta") said.push(part.text);
  expect(said).toEqual(["The hospital's leaflet says to come back if breathing gets harder.", "Rest today.", LINES.en.told]);
  expect(escalated).toEqual(["urgent"]);
  const system = log.messages[0]!.content;
  expect(system).toEndWith("Patient's record:\nMedicines: none\n\nHospital's general leaflets (advice for any patient, not facts about this patient):\n[1] Chest infection: Finish your antibiotic course as prescribed. Come back straight away if breathing gets harder.\n[2] Going home from hospital: Take your medicines as listed on your take-home sheet.");
  expect(system).toContain('"cites": [<leaflet numbers>]');
  expect(system).toContain("Never say something is in their record when it is not, and never invent a fact about them");
  expect(system).toContain('never answer or end with "ask your doctor or care team" instead of the answer itself');
  // 4 was never offered.
  expect(summaries).toEqual([{ grounded: false, urgent: true, sources: [{ title: "Chest infection", kind: "leaflet" }], withheld: 0, source: "model", model: "gemma-test" }]);
});

test("a call whose leaflet search failed is still answered, with none offered", async () => {
  const { chat, log } = gemma('{"triage":"fine","inPlan":false,"cites":[1]}\nIn general, rest and drink water.');
  const summaries: TurnSummary[] = [], said: string[] = [];
  for await (const part of answerTurn({ question: "How do I recover?", history: [], language: "en", signal: new AbortController().signal, chat, passages: Promise.reject(new Error("down")), escalate: async () => false, done: s => summaries.push(s) })) {
    if (part.type === "text-delta") said.push(part.text);
  }
  expect(said).toEqual(["In general, rest and drink water."]);
  expect(log.messages[0]!.content).toEndWith("None found for this question.");
  expect(summaries).toEqual([{ grounded: false, urgent: false, sources: [], withheld: 0, source: "model", model: "gemma-test" }]);
});

test("each leaflet is offered once, in the patient's language when that copy was found, best first and three at most", () => {
  const ms = hit("pneumonia", "ms", "Jangkitan paru-paru", "Habiskan kursus antibiotik."), other = (n: number) => hit(`other-${n}`, "en", `Leaflet ${n}`, "Text.");
  expect(passagesIn([CHEST, ms, HOME, other(1), other(2)], "ms").map(p => [p.n, p.title])).toEqual([[1, "Jangkitan paru-paru"], [2, "Going home from hospital"], [3, "Leaflet 1"]]);
  expect(passagesIn([ms, CHEST], "zh").map(p => p.title)).toEqual(["Jangkitan paru-paru"]);
  expect(citedSources([2, 2, 9, "1", null], passagesIn([CHEST, HOME], "en"))).toEqual([{ title: "Going home from hospital", kind: "leaflet" }]);
  expect(citedSources("1", passagesIn([CHEST], "en"))).toEqual([]);
});
