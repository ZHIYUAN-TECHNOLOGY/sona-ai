import { bookingRequests, tasks } from "@sona-ai/db/schema/clinical";
import { DEMO_HOSPITAL, seedDemo } from "@sona-ai/db/seed";
import { createTestDb } from "@sona-ai/db/testing";
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { boxState } from "../baseten-models";
import type { Library } from "../context";
import type { Change } from "../events";
import { stubModels } from "../models";
import { TRIAL, clefReplay, replay } from "../fixtures/clef-trial";
import { doctorsFor } from "../routers/bookings";
import { LINES } from "../voice-agent/answer";
import { asAnswer } from "./client";
import { alternating, chatTurn, historyFor, recentTurns, sonaMed, type ChatTurn } from "./turn";

// Each test starts knowing nothing about the boxes: another file's box left "starting" made Sona say so here (whole-suite runs).
beforeEach(() => boxState.clear());

const say = (role: "user" | "assistant", text: string, id = crypto.randomUUID()): UIMessage => ({ id, role, parts: [{ type: "text", text }] });
/** n questions, each answered. */
const conversation = (n: number) => Array.from({ length: n }, (_, i) => [say("user", `q${i}`), say("assistant", `a${i}`)]).flat();

test("the model reads the last 20 questions with their answers, starting at a question, and fewer when they are long", () => {
  const kept = recentTurns(conversation(25));
  expect(kept).toHaveLength(40);
  expect(kept.map(m => (m.parts[0] as { text: string }).text).slice(0, 2)).toEqual(["q5", "a5"]);
  // An answer with no question before it (the list cut mid-turn) is dropped.
  expect(recentTurns([say("assistant", "a"), say("user", "q")]).map(m => m.role)).toEqual(["user"]);
  // Over the word budget the oldest turns go, but the last always stays.
  const long = [say("user", "x".repeat(100)), say("assistant", "y".repeat(100)), say("user", "q"), say("assistant", "a")];
  expect(recentTurns(long, 20, 50).map(m => (m.parts[0] as { text: string }).text)).toEqual(["q", "a"]);
  expect(recentTurns([say("user", "x".repeat(100))], 20, 10)).toHaveLength(1);
  expect(recentTurns([])).toEqual([]);
});

test("a question left unanswered joins the next, so the roles alternate as chat templates want", async () => {
  const history = await historyFor([say("user", "first"), say("user", "second"), say("assistant", "answer"), say("user", "third")]);
  expect(history.map(m => m.role)).toEqual(["user", "assistant", "user"]);
  expect(history[0]!.content).toEqual([{ type: "text", text: "first" }, { type: "text", text: "second" }]);
  expect(alternating([{ role: "assistant", content: "a" }, { role: "assistant", content: [{ type: "text", text: "b" }] }])).toEqual([
    { role: "assistant", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
  ]);
});

/** An OpenAI-style streamed reply, as vLLM writes it: a tool call, or words. */
function sse(reply: { tool: string; args?: object } | { text: string }) {
  const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "gemma-4-26b-a4b", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const body = "tool" in reply
    ? chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call-${reply.tool}`, type: "function", function: { name: reply.tool, arguments: JSON.stringify(reply.args ?? {}) } }] }) + chunk({}, "tool_calls")
    : chunk({ role: "assistant", content: reply.text.slice(0, 10) }) + chunk({ content: reply.text.slice(10) }) + chunk({}, "stop");
  return new Response(`${body}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}

/** The brain box behind the adapter: up, answering each chat call with the next scripted reply; what it was sent is kept. */
function brain(replies: (Parameters<typeof sse>[0] | ((sent: any[]) => Parameters<typeof sse>[0]))[]) {
  const sent: any[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/sync/health")) return new Response("ok");
    if (!url.endsWith("/sync/v1/chat/completions")) return new Response("no", { status: 404 });
    sent.push(JSON.parse(String(init?.body)));
    const next = replies.shift()!;
    return sse(typeof next === "function" ? next(sent) : next);
  }) as typeof fetch;
  return { med: sonaMed({ apiKey: "test", fetcher }), sent };
}

async function world() {
  const db = await createTestDb();
  const now = new Date("2026-09-28T12:00:00+08:00");
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  const heard: Change[] = [];
  const context: ChatTurn["context"] = { db, session: null, models: stubModels, now: () => now, announce: async (_, change) => { heard.push(change); }, hospitalId: DEMO_HOSPITAL, patientId: "SYN-1042" };
  return { db, context, heard };
}

/** The answer as the agent stores it and the apps receive it: the stream read back into one message. */
async function answerOf(res: Response) {
  const chunks = (await res.text()).split("\n").filter(l => l.startsWith("data: ") && l !== "data: [DONE]").map(l => JSON.parse(l.slice(6)) as UIMessageChunk);
  let message: UIMessage | undefined;
  for await (message of readUIMessageStream({ stream: new ReadableStream({ start(c) { chunks.forEach(chunk => c.enqueue(chunk)); c.close(); } }) }));
  return { message: message!, answer: asAnswer(message!) };
}

const LEAFLET = { chunkId: "c1", documentId: "leaflet-pneumonia:en", sourceId: "s1", score: 1, text: "Rest, drink water and finish your antibiotics.", tags: { source: "Hospital leaflet", year: 2026, section: "Recovery", title: "Recovering from pneumonia" } };

test("Sona Med reads her record and a leaflet through the tools, with the conversation so far; the answer says where it came from", async () => {
  const { context } = await world();
  const library = { search: async () => [LEAFLET] } as unknown as Library;
  const { med, sent } = brain([
    { tool: "readMyRecord" },
    { tool: "searchLeaflets", args: { query: "pneumonia recovery" } },
    { text: "Your record lists your medicines. Rest and drink water [1]." },
  ]);
  const messages = [say("user", "What is pneumonia?"), say("assistant", "A lung infection."), say("user", "How do I get better at home?")];
  const { message, answer } = await answerOf(chatTurn({ context, messages, med, library }));

  // Each step was sent the tools, the instructions in her language, and the whole conversation.
  expect(sent).toHaveLength(3);
  expect(sent[0].tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(["readMyRecord", "searchLeaflets", "findDoctors", "requestBooking", "tellCareTeam"]);
  expect(sent[0].stream).toBe(true);
  expect(sent[0].messages.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  expect(sent[0].messages[0].content).toContain("answer in English");
  // The tools ran the app's own code: her record (recordText), then the leaflets, numbered.
  expect(sent[1].messages.at(-1).content).toContain("Visits booked:");
  expect(sent[2].messages.at(-1).content).toContain("[1] Recovering from pneumonia: Rest, drink water");

  expect(answer).toMatchObject({ answer: "Your record lists your medicines. Rest and drink water.", source: "model", model: "gemma-4-26b-a4b", grounded: true, urgent: false, sources: [{ title: "Recovering from pneumonia", kind: "leaflet" }] });
  expect(answer.careTeam).toBeUndefined();
  // The stored message keeps the tool calls (the model's own trail); the next turn's history prunes them.
  expect(message.parts.filter(p => p.type.startsWith("tool-")).map(p => p.type)).toEqual(["tool-readMyRecord", "tool-searchLeaflets"]);
  expect((await historyFor([...messages, message, say("user", "Thanks")])).map(m => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
});

test("finding a doctor and asking for a time is the app's own booking: one request, one care-team task, the hospital told", async () => {
  const { db, context, heard } = await world();
  const [lim] = await doctorsFor(context, "respiratory");
  const at = lim!.nextSlots[0]!.times[0]!.toISOString();
  const { med, sent } = brain([
    { tool: "findDoctors", args: { search: "respiratory" } },
    { tool: "requestBooking", args: { doctorId: lim!.id, startsAt: at, reason: "cough" } },
    sent => ({ text: sent.at(-1).messages.at(-1).content.includes('"requested":true') ? "Done, the care team will confirm it." : "It did not work." }),
  ]);
  const { answer } = await answerOf(chatTurn({ context, messages: [say("user", "Yes please, book Dr Lim for that time")], med }));

  expect(answer.answer).toBe("Done, the care team will confirm it.");
  expect(answer.doctors.map(d => d.name)).toEqual(["Dr. Lim Wei Jie"]);
  expect(answer.grounded).toBe(false);
  const [request] = await db.select().from(bookingRequests).where(eq(bookingRequests.patientId, "SYN-1042"));
  expect([request!.doctorId, request!.startsAt.toISOString(), request!.status, request!.reason]).toEqual([lim!.id, at, "requested", "cough"]);
  const [task] = await db.select().from(tasks).where(eq(tasks.id, request!.taskId!));
  expect([task!.kind, task!.owner]).toEqual(["booking", "Care team"]);
  expect(heard).toEqual([{ topic: "bookings", patientId: "SYN-1042" }]);
});

test("an emergency she reports now reaches her care team with no model at all; the model's own call shares that one task", async () => {
  const { db, context } = await world();
  // No model: Sona says she cannot answer, and the keyword floor still tells the care team.
  const off = (await answerOf(chatTurn({ context, messages: [say("user", "I have chest pain right now")] }))).answer;
  expect(off).toMatchObject({ answer: LINES.en.unavailable, source: "fixture", urgent: true });
  expect(off.careTeam).toMatchObject({ line: LINES.en.told });
  // With the model calling tellCareTeam too, it rides on the same task.
  const { med } = brain([{ tool: "tellCareTeam" }, { text: "Please call 999 now." }]);
  const on = (await answerOf(chatTurn({ context, messages: [say("user", "Sakit dada sekarang")], med }))).answer;
  expect(on).toMatchObject({ answer: "Please call 999 now.", urgent: true, careTeam: { taskId: off.careTeam!.taskId, line: LINES.ms.told } });
  expect(await db.select().from(tasks).where(eq(tasks.kind, "check-in"))).toHaveLength(1);
});

test("an emergency Clef reads (no 999 words, the model calling no tool) reaches her care team once, as an urgent task, beside the model's words", async () => {
  const { db, context } = await world();
  const { ai } = clefReplay(replay("c049", "c054"));
  const { med } = brain([{ text: "Bawa ayah anda ke hospital sekarang." }, { text: "Bagus, teruskan." }]);
  const { answer } = await answerOf(chatTurn({ context: { ...context, clef: ai }, messages: [say("user", TRIAL.c049.said)], med }));
  // `urgent` stays the model's: the phone would show the 999 card in place of the model's words.
  expect(answer).toMatchObject({ answer: "Bawa ayah anda ke hospital sekarang.", urgent: false, careTeam: { line: LINES.en.told } });
  const [task] = await db.select().from(tasks).where(eq(tasks.kind, "check-in"));
  expect(task!.id).toBe(answer.careTeam!.taskId);
  // Below 0.25 (insulin taken, 0.2233): nobody is told.
  const calm = (await answerOf(chatTurn({ context: { ...context, clef: ai }, messages: [say("user", TRIAL.c054.said)], med }))).answer;
  expect(calm).toMatchObject({ urgent: false });
  expect(calm.careTeam).toBeUndefined();
});

test("while Sona Med's box starts, Sona says how long and the model is not asked; a failing box gets her can't-answer line", async () => {
  const { context } = await world();
  let asked = false;
  const med = { model: brain([]).med.model, waking: async () => { asked = true; return 7; } };
  const { answer } = await answerOf(chatTurn({ context, messages: [say("user", "Bilakah lawatan saya?")], med }));
  expect(asked).toBe(true);
  expect(answer).toMatchObject({ answer: LINES.ms.starting(7), source: "fixture", waking: 7, grounded: false });
  // A box that fails mid-turn: Sona says she cannot answer, never an empty answer.
  const failing = sonaMed({ apiKey: "test", fetcher: (async (input: RequestInfo | URL) => new Response("down", { status: String(input).endsWith("/sync/health") ? 200 : 500 })) as typeof fetch });
  expect((await answerOf(chatTurn({ context, messages: [say("user", "What do I eat?")], med: failing }))).answer).toMatchObject({ answer: LINES.en.unavailable, source: "fixture" });
});
