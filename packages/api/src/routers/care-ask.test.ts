import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, guaranteeLetters, tasks } from "@sona-ai/db/schema/clinical";
import { partsOf } from "@sona-ai/domain/answer-parts";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { BOXES, basetenModels, boxState, type Baseten } from "../baseten-models";
import { chatModels, type Chat } from "../chat-models";
import { CLEF_MODEL, clefOf } from "../decide";
import { TRIAL, clefReplay, replay } from "../fixtures/clef-trial";
import { stubModels, type Models } from "../models";
import { LINES } from "../voice-agent/answer";
import type { WorkersAi } from "../workers-models";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** Amelia discharged in Malay and joined (care-voice.test's world), asking with `models`. */
const world = async (models: Models) => (await clefWorld(models)).amelia;

/** The same world with Clef (`clef`), its database, and a clock to move her day on. */
async function clefWorld(models: Models, clef?: WorkersAi, baseten?: Baseten) {
  const clock = { now: new Date("2026-09-28T10:05:00+08:00") }, now = clock.now, db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await addClinician(db, "dr-aisyah");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => clock.now, models, clef, baseten } });
  const doctor = as("dr-aisyah"), amelia = as("amelia-account");
  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  return { amelia, db, clock };
}

test("the model's answer reaches her whole: nothing is withheld and no not-found line is added (founder, 9 Oct)", async () => {
  // Her record holds no potassium: the old grounding filter cut that sentence and added "I could not find that in your record".
  const answer = "Ambil Azithromycin sekali sehari. Kalium anda ialah 3.1 mmol/L.";
  const amelia = await world({ ...stubModels, answerFromPlan: async () => ({ answer, grounded: true, urgent: false, from: "medicines", source: "model", model: "gemma-test" }) });
  expect(await amelia.care.ask({ question: "Apa ubat saya?" })).toEqual({ answer, grounded: true, urgent: false, from: "medicines", sources: [], withheld: 0, source: "model", model: "gemma-test" });
});

test("a follow-up is read in the light of the chat so far (staging, 9 Oct: \"How does it help?\" after \"What is panadol\")", async () => {
  const asked: { said: string; maxTokens?: number }[] = [];
  const long = `Paracetamol eases pain and brings a fever down. ${"It is general information. ".repeat(50)}`.trim();
  const chat: Chat = async (_, said, maxTokens) => { asked.push({ said, maxTokens }); return { answer: long, grounded: false, urgent: false, cites: [] }; };
  const amelia = await world({ ...stubModels, ...chatModels(chat, "gemma-test", stubModels) });
  const history = [
    // Sona's told line, if the app sends it back inside an answer, is not shown to the model to copy.
    { question: "What is panadol", answer: `Panadol is paracetamol, a common medicine for pain and fever. ${LINES.en.told}` },
    { question: "Is it safe?", answer: "Yes, at the usual dose." },
  ];
  const answer = await amelia.care.ask({ question: "How does it help?", history });
  // A longer answer than before (800 characters) is shown whole, with room to write it.
  expect(answer).toMatchObject({ answer: long, grounded: false, withheld: 0 });
  expect(long.length).toBeGreaterThan(800);
  expect(asked).toHaveLength(1);
  expect(asked[0]!.maxTokens).toBe(1000);
  expect(asked[0]!.said).toStartWith("Conversation so far:\nPatient: What is panadol\nSona Care: Panadol is paracetamol, a common medicine for pain and fever.\n\nPatient: Is it safe?\nSona Care: Yes, at the usual dose.\n\nPatient's question, written in English.");
  expect(asked[0]!.said).toEndWith(": How does it help?");
  // A first question has no conversation before it; a chat sent with more than six earlier turns is refused.
  await amelia.care.ask({ question: "What is panadol" });
  expect(asked[1]!.said).toStartWith("Patient's question, written in English.");
  const seven = Array.from({ length: 7 }, () => ({ question: "Why?", answer: "Because." }));
  expect((await amelia.care.ask({ question: "And then?", history: seven }).catch(e => e)).code).toBe("BAD_REQUEST");
});

/** A Gemma that must not be asked: a lane turn is answered without it. */
const noGemma = (asked: string[]): Models => ({ ...stubModels, answerFromPlan: async ({ question }) => { asked.push(question); return { answer: "Gemma's answer.", grounded: false, urgent: false, source: "model", model: "gemma-test" }; } });

test("a lane turn Clef is sure of is answered at once from her record, in her language, with cards and no Gemma", async () => {
  const asked: string[] = [];
  const { ai } = clefReplay(replay("c035", "c057", "c077"));
  const { amelia } = await clefWorld(noGemma(asked), ai);
  const answer = await amelia.care.ask({ question: TRIAL.c035.said });
  expect(answer).toEqual({
    answer: "Your next visit is Clinic review, Mon 12 Oct.", grounded: true, from: "visits", urgent: false, source: "model", model: CLEF_MODEL, withheld: 0, sources: [],
    marks: [{ text: "Mon 12 Oct", kind: "dose" }],
    cards: [{ type: "appointment", title: "Clinic review", when: "2026-10-12T02:05:00.000Z", status: "upcoming" }],
    lane: { intent: "next_appointment", confidence: 0.9232, by: "clef-omni" },
  });
  // Every client reads it through the contract as it was sent.
  expect(partsOf(answer)).toEqual({ marks: answer.marks, cards: answer.cards, lane: answer.lane });
  expect((await amelia.care.ask({ question: TRIAL.c057.said })).answer).toBe("Lawatan anda yang seterusnya: Semakan klinik, Isn, 12 Okt.");
  expect((await amelia.care.ask({ question: TRIAL.c077.said })).answer).toBe("您的下一次预约：门诊复诊，10月12日 周一。");
  expect(asked).toEqual([]);
});

test("a booking, dose or reading Clef is sure of is drafted under Gemma's answer, never in its place, as the app's own call takes it", async () => {
  const asked: string[] = [];
  const bp = "my blood pressure this morning 138/86", low = "sugar just now 2.1", other = "I just took my paracetamol";
  const { ai } = clefReplay({
    ...replay("c021", "c035"), "I just took my azithromycin": TRIAL.c053, [other]: TRIAL.c053,
    [bp]: { ...TRIAL.c030, picks: { reading: "blood_pressure" } }, [low]: { ...TRIAL.c030, picks: { reading: "blood_glucose" } },
  });
  // Gemma reads a sugar of 2.1 as urgent (11 Oct review: the lane once answered it "ready to save", Gemma never asked).
  const models: Models = { ...stubModels, answerFromPlan: async ({ question }) => { asked.push(question); return { answer: "Gemma's answer.", grounded: false, urgent: question === low, source: "model", model: "gemma-test" }; } };
  const { amelia, clock } = await clefWorld(models, ai);
  const action = (a: { cards?: unknown }) => partsOf(a).cards!.find(c => c.type === "action")!;

  const book = await amelia.care.ask({ question: TRIAL.c021.said });
  expect(book).toMatchObject({ answer: "Gemma's answer.", model: "gemma-test" });
  // Gemma answered, so the turn carries no lane: the draft is the lane's only part.
  expect(partsOf(book)).toEqual({ cards: [action(book)] });
  const draft = action(book);
  expect(draft).toMatchObject({ do: "book", items: ["Respiratory", expect.any(String)], confirm: "Request this time", payload: { doctorId: "lim", startsAt: "2026-09-30T01:00:00.000Z" } });
  if (draft.do === "book") expect(await amelia.care.bookings.request(draft.payload)).toMatchObject({ doctorId: "lim", status: "requested" });
  // Her next visit is still the booked one; the time she asked for, sooner, comes first among the cards, by date.
  const next = await amelia.care.ask({ question: TRIAL.c035.said });
  expect(next.answer).toBe("Your next visit is Clinic review, Mon 12 Oct.");
  expect(partsOf(next).cards!.map(c => c.type === "appointment" && `${c.status} ${c.when}`)).toEqual(["requested 2026-09-30T01:00:00.000Z", "upcoming 2026-10-12T02:05:00.000Z"]);

  const reading = await amelia.care.ask({ question: bp });
  const save = action(reading);
  expect(save).toMatchObject({ do: "logReading", title: "Blood pressure 138/86 mmHg", confirm: "Save reading" });
  if (save.do === "logReading") expect(await amelia.care.readings.add(save.payload)).toMatchObject({ kind: "blood_pressure", value: 138, value2: 86 });
  // A reading Gemma reads as urgent drafts nothing: the 999 card leads, and nothing to save.
  const urgent = await amelia.care.ask({ question: low });
  expect(urgent).toMatchObject({ answer: "Gemma's answer.", urgent: true });
  expect(partsOf(urgent).cards!.map(c => c.type)).toEqual(["warning"]);

  // The next morning her 08:00 azithromycin is open (last night's cetirizine is past marking).
  clock.now = new Date("2026-09-29T08:20:00+08:00");
  const dose = await amelia.care.ask({ question: "I just took my azithromycin" });
  const take = action(dose);
  expect(take).toMatchObject({ do: "logDose", title: "Azithromycin", confirm: "Mark taken" });
  // While it is open, a medicine with none (paracetamol, as needed) is never matched to it: no draft to mark the antibiotic.
  expect(partsOf(await amelia.care.ask({ question: other })).cards).toBeUndefined();
  if (take.do === "logDose") expect(await amelia.care.doses.take(take.payload)).toEqual({ key: "Azithromycin@2026-09-29T00:00:00.000Z" });
  expect(asked).toEqual([TRIAL.c021.said, bp, low, "I just took my azithromycin", other]);
});

test("Gemma answers what the lane is not sure of: a question besides, something called off, numbers in words, a slow or missing Clef", async () => {
  const asked: string[] = [];
  const spoken = TRIAL.c030.said, worried = "my bp just now 150/95 is that too high should i worry";
  const { ai, calls } = clefReplay({
    [spoken]: { ...TRIAL.c030, picks: { reading: "blood_pressure" } }, [worried]: { ...TRIAL.c030, asks: 0.93, picks: { reading: "blood_pressure" } },
    "cancel my appointment next week": TRIAL.c021,
  });
  const { amelia } = await clefWorld(noGemma(asked), ai);
  for (const question of [worried, "cancel my appointment next week", spoken]) {
    const answer = await amelia.care.ask({ question });
    expect(answer).toMatchObject({ answer: "Gemma's answer.", model: "gemma-test" });
    expect(partsOf(answer)).toEqual({});
  }
  expect(asked).toEqual([worried, "cancel my appointment next week", spoken]);
  expect(calls).toHaveLength(3);

  // Clef that never answers: Gemma's answer, after DECIDE_MS at most.
  const slow = await clefWorld(noGemma([]), { run: () => new Promise(() => {}) });
  const began = Date.now();
  expect(await slow.amelia.care.ask({ question: TRIAL.c035.said })).toMatchObject({ answer: "Gemma's answer." });
  expect(Date.now() - began).toBeLessThan(2000);
  // CLEF_LANE off: no Clef in the context, so it is never called, and the answer is today's.
  const off = clefReplay(replay("c035"));
  expect(await (await clefWorld(noGemma([]), clefOf({ CLEF_LANE: "", AI: off.ai }))).amelia.care.ask({ question: TRIAL.c035.said })).toMatchObject({ answer: "Gemma's answer." });
  expect(off.calls).toHaveLength(0);
});

test("an emergency Clef reads (0.25 or more) reaches her care team once and brings the 999 card; `urgent` and Gemma's words stay Gemma's", async () => {
  const { ai } = clefReplay(replay("c049", "c054"));
  let urgent = false;
  const models: Models = { ...stubModels, answerFromPlan: async () => ({ answer: "Bawa ayah anda ke hospital sekarang.", grounded: false, urgent, source: "model", model: "gemma-test" }) };
  const { amelia, db } = await clefWorld(models, ai);
  // No 999 words, and Gemma did not flag it: Clef's 0.2676 does, and the task says Clef read it. Not `urgent`: the phone
  // would show its 999 card in place of Gemma's words, and a near miss (insulin, 0.2233) is that close.
  const first = await amelia.care.ask({ question: TRIAL.c049.said });
  expect(first).toMatchObject({ answer: "Bawa ayah anda ke hospital sekarang.", urgent: false, careTeam: { label: "urgent", readBy: { source: "model", model: CLEF_MODEL, decidedBy: "model" }, line: LINES.en.told } });
  expect(partsOf(first).cards![0]).toMatchObject({ type: "warning", level: "urgent", title: "Call 999 now" });
  // Gemma's own urgent flag on the same words rides on the same task.
  urgent = true;
  const again = await amelia.care.ask({ question: TRIAL.c049.said });
  expect(again.careTeam?.taskId).toBe(first.careTeam!.taskId);
  expect(await db.select().from(tasks).where(eq(tasks.kind, "check-in"))).toHaveLength(1);
  // Insulin taken (0.2233) is not an emergency: no 999 card. Clef never makes an urgent answer calm.
  urgent = false;
  const calm = await amelia.care.ask({ question: TRIAL.c054.said });
  expect(calm).toMatchObject({ urgent: false });
  expect(partsOf(calm).cards).toBeUndefined();
  urgent = true;
  expect(await amelia.care.ask({ question: TRIAL.c054.said })).toMatchObject({ urgent: true });
});

test("a model answer naming her medicine carries its card from her plan; one naming a medicine she does not take carries none", async () => {
  const answer = "Ambil Azithromycin sekali sehari. Panadol boleh untuk demam.";
  const marks = [{ text: "Azithromycin", kind: "medicine" as const }, { text: "Panadol", kind: "medicine" as const }];
  const amelia = await world({ ...stubModels, answerFromPlan: async () => ({ answer, grounded: true, urgent: false, marks, source: "model", model: "gemma-test" }) });
  const asked = await amelia.care.ask({ question: "Apa ubat saya?" });
  expect(asked.marks).toEqual(marks);
  expect(asked.cards).toEqual([{ type: "medicine", name: "Azithromycin", dose: "1 tablet, sebelum atau selepas makan", how: "Kini sebiji tablet sehari, selama 2 hari lagi", times: ["08:00"], source: "Pelan discaj anda" }]);
});

/** Box ① answering `reply` (JSON, as Gemma writes it): whole when asked whole (care.ask), a few characters a millisecond when streamed. */
function brain(reply: string): Baseten {
  // Up, whatever an earlier test file left it as (the adapter keeps what it learns for the isolate).
  boxState.delete("brain");
  const piece = (content: string) => new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  const fetcher = (async (url: string, init: RequestInit) => {
    if (!url.includes(BOXES.brain) || url.endsWith("/health")) return new Response("ok");
    if (!JSON.parse(init.body as string).stream) return Response.json({ choices: [{ message: { content: reply } }] });
    const pieces = reply.match(/[\s\S]{1,5}/g)!;
    return new Response(new ReadableStream({ async pull(c) { await Bun.sleep(1); const p = pieces.shift(); if (p) c.enqueue(piece(p)); else c.close(); } }), { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  return { apiKey: "k", fetcher };
}
type Streamed = Awaited<ReturnType<Awaited<ReturnType<typeof world>>["care"]["askStream"]>>;
/** Every event of one streamed answer, in order, and its words put together as the app puts them. */
async function streamed(events: Streamed) {
  const all = [];
  let words = "";
  for await (const e of events) { all.push(e); if (e.type === "words") words = words.slice(0, e.at) + e.text; }
  return { all, words, answer: all.at(-1)!.type === "answer" ? (all.at(-1) as { answer: unknown }).answer : undefined };
}

test("askStream: the lane's drafted card with its line first, then Gemma's words as she writes them, then care.ask's own answer", async () => {
  const reply = JSON.stringify({ answer: "Dr Lim has a morning free next week [1].\n- Tap \"Request this time\" to ask for it.", grounded: false, urgent: false, from: "", cites: [], marks: { dose: ["next week"] } });
  const baseten = brain(reply), { ai } = clefReplay(replay("c021", "c021"));
  const { amelia } = await clefWorld(basetenModels(baseten), ai, baseten);
  const asked = await amelia.care.ask({ question: TRIAL.c021.said });
  const { all, words, answer } = await streamed(await amelia.care.askStream({ question: TRIAL.c021.said }));
  // Exactly care.ask's answer, its words put together from the pieces, with no leaflet number on the way.
  expect(answer).toEqual(asked);
  expect(words).toBe("Dr Lim has a morning free next week.\n- Tap \"Request this time\" to ask for it.");
  expect(all.filter(e => e.type === "words").length).toBeGreaterThan(5);
  expect(all.some(e => e.type === "words" && /\[/.test(e.text))).toBe(false);
  // The draft and its line come before the first word, so the words never move down.
  expect(all[0]).toEqual({ type: "lane", lead: "Here is a time you can request.", card: partsOf(asked).cards!.find(c => c.type === "action")! });
  expect(all.slice(1, -1).every(e => e.type === "words")).toBe(true);
});

test("askStream: the 999 card at once, again with her warning signs once her record is read, before any word; the care team told once", async () => {
  const reply = JSON.stringify({ answer: "Call 999 now. Sit down and rest.", grounded: false, urgent: true, cites: [], marks: { warning: ["Call 999"] } });
  const baseten = brain(reply);
  const { amelia, db } = await clefWorld(basetenModels(baseten), undefined, baseten);
  const { all, answer } = await streamed(await amelia.care.askStream({ question: "I have chest pain right now" }));
  expect(all[0]).toEqual({ type: "call999", card: { type: "warning", level: "urgent", title: "Call 999 now", items: [] } });
  expect(all[1]).toMatchObject({ type: "call999", card: { type: "warning", level: "urgent", items: expect.arrayContaining([expect.any(String)]) } });
  expect(all[2]!.type).toBe("words");
  expect(answer).toMatchObject({ answer: "Call 999 now. Sit down and rest.", urgent: true, careTeam: { line: LINES.en.told } });
  expect(partsOf(answer).cards![0]).toEqual((all[1] as { card: unknown }).card);
  expect(await db.select().from(tasks).where(eq(tasks.kind, "check-in"))).toHaveLength(1);
});

test("askStream with no hosted Gemma: the answer still comes, whole, as care.ask's", async () => {
  const amelia = await world({ ...stubModels, answerFromPlan: async () => ({ answer: "Ambil ubat.", grounded: true, urgent: false, source: "model", model: "gemma-test" }) });
  const { all, answer } = await streamed(await amelia.care.askStream({ question: "Apa ubat saya?" }));
  expect(all).toHaveLength(1);
  expect(answer).toEqual(await amelia.care.ask({ question: "Apa ubat saya?" }));
});
