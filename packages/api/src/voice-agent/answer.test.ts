import { beforeEach, expect, test } from "bun:test";

import { boxState } from "../baseten-models";
import { deltas } from "../sse";
import { LINES, answerTurn, basetenChat, flagsOf, messagesFor, sentencesOf, type AnswerTurn, type ChatStream, type Part, type TurnSummary } from "./answer";

/** Amelia's plan as Gemma reads it (planText, discharged in Malay). */
const PLAN = `Discharged: 2026-09-28T02:05:00.000Z
Medicines:
- Paracetamol (new): For pain or fever: 1 g every 6 hours if you need it, no more than 4 g a day
- Azithromycin (changed): Now a tablet once a day, for 2 more days; 1 tablet, with or without food
- Salbutamol nebuliser (stopped): Use your own inhaler instead, when you need it
- Cetirizine (continue): Keep taking it as before; 1 tablet at night
Come back or call if:
- Breathing gets harder
- Your lips or fingertips turn blue
- The fever comes back
- Chest pain, or you feel faint
Follow-up: Clinic review on Mon Oct 12 2026
Check-ins: day 2 and 7 after discharge
Leaflet (BM):
Anda dirawat kerana jangkitan paru-paru. Makan azithromycin sekali sehari selama 2 hari lagi. Datang semula segera jika sukar bernafas, bibir menjadi biru, atau demam kembali.`;

/** A Gemma that writes `chunks` in turn, noting how far it was read and whether the reader hung up. */
function gemma(chunks: string[]) {
  const log = { pulled: 0, closed: false, messages: [] as { role: string; content: string }[] };
  const chat: ChatStream = async messages => {
    log.messages = messages;
    return { model: "gemma-test", text: (async function* () { try { for (const c of chunks) { log.pulled++; yield c; } } finally { log.closed = true; } })() };
  };
  return { chat, log };
}
function turnOf(over: Partial<AnswerTurn> & Pick<AnswerTurn, "question">) {
  const summaries: TurnSummary[] = [], escalated: string[] = [];
  const turn: AnswerTurn = { history: [], plan: PLAN, language: "en", signal: new AbortController().signal, escalate: async label => { escalated.push(label); return false; }, done: s => summaries.push(s), ...over };
  return { turn, summaries, escalated };
}
/** The sentences spoken, checking each is handed on as one part and then an end (so the SDK speaks it at once). */
async function spoken(turn: AnswerTurn) {
  const parts: Part[] = [];
  for await (const part of answerTurn(turn)) parts.push(part);
  parts.forEach((p, i) => expect(p.type).toBe(i % 2 ? "text-end" : "text-delta"));
  return parts.flatMap(p => (p.type === "text-delta" ? [p.text] : []));
}

beforeEach(() => boxState.clear());

test("each sentence is handed on as soon as Gemma finishes it, after the flags line, with the plan and history in the chat", async () => {
  const { chat, log } = gemma(['{"triage":"fine",', '"inPlan":true}\nYour plan says take 1 tablet of azith', "romycin once a day. It is for 2 more", " days."]);
  const { turn, summaries } = turnOf({ question: "After breakfast or dinner?", chat, history: [{ role: "user", content: "When do I take azithromycin?" }, { role: "assistant", content: "Once a day." }] });
  const parts = answerTurn(turn);
  expect((await parts.next()).value).toEqual({ type: "text-delta", text: "Your plan says take 1 tablet of azithromycin once a day." });
  expect(log.pulled).toBe(3); // the last chunk is not needed yet
  const rest: string[] = [];
  for await (const p of parts) if (p.type === "text-delta") rest.push(p.text);
  expect(rest).toEqual(["It is for 2 more days."]);
  expect(summaries).toEqual([{ grounded: true, urgent: false, source: "model", model: "gemma-test" }]);
  expect(log.messages.map(m => m.role)).toEqual(["system", "user", "assistant", "user"]);
  expect(log.messages[0]!.content).toContain("Azithromycin (changed): Now a tablet once a day");
  expect(log.messages.at(-1)!.content).toBe("After breakfast or dinner?");
});

test("every sentence Gemma writes is said as written: no limit on numbers, doses or conditions (user, 1 Oct)", async () => {
  const { chat, log } = gemma(['{"triage":"fine","inPlan":false}\n', "Adults usually take at most 4 g of paracetamol a day. ",
    "High blood pressure means the pressure stays above 140 over 90. Diabetes means your blood sugar runs high."]);
  expect(await spoken(turnOf({ question: "What is the most paracetamol I can take, and what is diabetes?", chat }).turn))
    .toEqual(["Adults usually take at most 4 g of paracetamol a day.", "High blood pressure means the pressure stays above 140 over 90.", "Diabetes means your blood sugar runs high."]);
  expect(log.messages[0]!.content).toContain("Answer whatever they ask");
});

test("an emergency sign: the 999 line first, before Gemma is even heard, Gemma's own 999 line not repeated, then the care team told", async () => {
  const { chat, log } = gemma(['{"triage":"urgent","inPlan":true}\nSila hubungi 999 sekarang. ', "Pelan anda menyatakan datang semula jika sakit dada."]);
  const { turn, escalated, summaries } = turnOf({ question: "Saya sakit dada sekarang", language: "ms", chat, escalate: async label => { escalated.push(label); return true; } });
  const parts = answerTurn(turn);
  expect((await parts.next()).value).toEqual({ type: "text-delta", text: LINES.ms.call999 });
  expect(log.pulled).toBe(0);
  const rest: string[] = [];
  for await (const p of parts) if (p.type === "text-delta") rest.push(p.text);
  expect(rest).toEqual(["Pelan anda menyatakan datang semula jika sakit dada.", LINES.ms.told]);
  expect([escalated, summaries[0]!.urgent]).toEqual([["urgent"], true]);
});

test("Gemma's urgent flag also puts the 999 line first; a patient feeling worse is passed on, and told so only once a task exists", async () => {
  const urgent = turnOf({ question: "I feel confused and dizzy", chat: gemma(['{"triage":"urgent","inPlan":true}\nYour plan says to come back if you feel faint.']).chat });
  expect(await spoken(urgent.turn)).toEqual([LINES.en.call999, "Your plan says to come back if you feel faint."]);
  expect(urgent.escalated).toEqual(["urgent"]);

  const worse = (made: boolean) => turnOf({
    question: "My fever came back last night", escalate: async () => { await Bun.sleep(20); return made; },
    chat: gemma(['{"triage":"worse","inPlan":true}\nYour plan says to come back if the fever comes back.']).chat,
  });
  expect(await spoken(worse(true).turn)).toEqual(["Your plan says to come back if the fever comes back.", LINES.en.told]);
  expect(await spoken(worse(false).turn)).toEqual(["Your plan says to come back if the fever comes back."]);
  // A plain question is not a report: nobody is told.
  const fine = turnOf({ question: "When is my review?", chat: gemma(['{"triage":"fine","inPlan":true}\nYour review is on 12 October.']).chat });
  await spoken(fine.turn);
  expect(fine.escalated).toEqual([]);
});

test("'I've let your care team know' is said once, by Sona when a task exists: Gemma echoing it from an earlier answer is not heard, nor sent back to it", async () => {
  // Staging, 1 Oct: the second call's answer said it twice, Gemma copying the first call's last line.
  for (const language of ["ms", "en", "zh"] as const) {
    const told = LINES[language].told;
    const { chat, log } = gemma([`{"triage":"worse","inPlan":true}\nYour plan says to come back if the fever comes back. ${told}`]);
    const history = [{ role: "user" as const, content: "Saya demam." }, { role: "assistant" as const, content: `Your plan says to come back if the fever comes back. ${told}` }];
    const { turn } = turnOf({ question: "Saya batuk, still demam.", language, chat, history, escalate: async () => true });
    expect(await spoken(turn)).toEqual(["Your plan says to come back if the fever comes back.", told]);
    expect(log.messages[2]).toEqual({ role: "assistant", content: "Your plan says to come back if the fever comes back." });
    // Gemma claiming it with no task made is not heard either.
    expect(await spoken(turnOf({ question: "Saya batuk.", language, chat: gemma([`{"triage":"worse","inPlan":true}\n${told}`]).chat }).turn)).toEqual([LINES[language].unavailable]);
  }
});

test("honest when there is no answer: Gemma starting (with its minutes), a reply with no words; a patient still in hospital is answered too; a reply without flags still counts", async () => {
  const starting = turnOf({ question: "Bila saya makan ubat?", language: "ms", chat: async () => ({ waking: 12 }) });
  expect(await spoken(starting.turn)).toEqual([LINES.ms.starting(12)]);
  expect(starting.summaries).toEqual([{ grounded: false, urgent: false, source: "fixture", waking: 12 }]);
  const notSaid = turnOf({ question: "Can I fly next week?", chat: gemma(['{"triage":"fine","inPlan":false}']).chat });
  expect(await spoken(notSaid.turn)).toEqual([LINES.en.unavailable]);
  expect(notSaid.summaries[0]!.grounded).toBe(false);
  let asked = false;
  expect(await spoken(turnOf({ question: "When can I go home?", plan: undefined, chat: async messages => { asked = messages[0]!.content.includes("None yet: they are still in hospital."); return { waking: 1 }; } }).turn)).toEqual([LINES.en.starting(1)]);
  expect(asked).toBe(true);
  const bare = turnOf({ question: "Can I rest?", chat: gemma(["Your plan says rest ", "at home."]).chat });
  expect(await spoken(bare.turn)).toEqual(["Your plan says rest at home."]);
  expect(bare.summaries[0]!.grounded).toBe(true);
  const broken = turnOf({ question: "Can I rest?", chat: async () => ({ model: "gemma-test", text: (async function* () { throw new Error("connection reset"); })() }) });
  expect(await spoken(broken.turn)).toEqual([LINES.en.unavailable]);
});

/** Box ① behind a fake network: streamed SSE, an abort errors the body (as fetch does), and a cancel is noted. */
function brain(chunks: string[], hold: number) {
  const log = { cancelled: false, signal: undefined as AbortSignal | undefined, body: undefined as Record<string, unknown> | undefined };
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/sync/health")) return new Response("ok");
    log.signal = init!.signal!;
    log.body = JSON.parse(String(init!.body));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { init!.signal!.addEventListener("abort", () => controller.error(new DOMException("The operation was aborted.", "AbortError"))); },
      pull(controller) {
        if (sent >= chunks.length) return controller.close();
        if (sent >= hold) return new Promise<void>(() => {}); // Gemma still writing
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[sent++] } }] })}\n\n`));
      },
      cancel() { log.cancelled = true; },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  return { chat: basetenChat({ apiKey: "test", fetcher }), log };
}

test("an interruption cancels the in-flight Gemma stream: the patient barging in aborts the request, and nothing more is said", async () => {
  const { chat, log } = brain(['{"triage":"fine","inPlan":true}\n', "Your plan says rest at home. ", "Drink plenty of water."], 2);
  const interrupt = new AbortController();
  const { turn, summaries } = turnOf({ question: "Can I rest?", chat, signal: interrupt.signal });
  const parts = answerTurn(turn);
  expect((await parts.next()).value).toEqual({ type: "text-delta", text: "Your plan says rest at home." });
  expect((await parts.next()).value).toEqual({ type: "text-end" });
  expect(log.body).toMatchObject({ model: "gemma-4-26b-a4b", stream: true });
  const next = parts.next(); // waiting on Gemma's next words
  interrupt.abort();
  expect(await next).toEqual({ done: true, value: undefined });
  expect([log.signal!.aborted, summaries]).toEqual([true, []]);
});

test("the SDK hanging up mid-answer cancels the stream too, so vLLM stops writing", async () => {
  const { chat, log } = brain(['{"triage":"fine","inPlan":true}\n', "Your plan says rest at home. ", "Drink plenty of water. "], 2);
  const parts = answerTurn(turnOf({ question: "Can I rest?", chat }).turn);
  await parts.next();
  await parts.return(undefined);
  expect(log.cancelled).toBe(true);
});

test("server-sent events: text split anywhere (a character's bytes too) comes back whole; reasoning and [DONE] are skipped", async () => {
  const frames = [`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "hmm" } }] })}\n\n`, `data: ${JSON.stringify({ choices: [{ delta: { content: "您的计划" } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: "写着。" } }] })}\n\n`, "data: [DONE]\n\n"];
  const bytes = new TextEncoder().encode(frames.join(""));
  const body = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); } });
  let finished = false;
  const out: string[] = [];
  for await (const text of deltas(body, () => { finished = true; })) out.push(text);
  expect([out, finished]).toEqual([["您的计划", "写着。"], true]);
});

test("the chat alternates turns, as chat templates require; flags may be fenced or missing; sentences split as spoken", () => {
  const chat = messagesFor({ question: "after food?", plan: PLAN, language: "ms", history: [{ role: "assistant", content: "Hello." }, { role: "user", content: "When do I take it" }, { role: "user", content: "the antibiotic" }] });
  expect(chat.map(m => [m.role, m.role === "system" ? "" : m.content])).toEqual([["system", ""], ["user", "When do I take it\nthe antibiotic\nafter food?"]]);
  expect(chat[0]!.content).toContain("answer in Malay");

  expect(flagsOf('```json\n{"triage": "worse", "inPlan": true}\n```\nYour plan says')).toEqual([{ triage: "worse", inPlan: true }, "\nYour plan says"]);
  expect(flagsOf('{"triage": "wor')).toBeUndefined();
  expect(flagsOf("Your plan says rest.")).toEqual([null, "Your plan says rest."]);

  expect(sentencesOf("See Dr. Lim on 12 October. Take 2.5 mg tonight! 请您每天早上吃一片药，饭后吃。然后多休息，多喝")).toEqual([["See Dr. Lim on 12 October.", "Take 2.5 mg tonight!", "请您每天早上吃一片药，饭后吃。"], "然后多休息，多喝"]);
  // As the SDK's chunker and Sona Care's karaoke count: under 10 characters joins the next; every sentence ends with a mark.
  expect(sentencesOf("Ya. Your plan says rest.\n- Drink water", true)).toEqual([["Ya. Your plan says rest.", "Drink water."], ""]);
  expect(sentencesOf("**请多休息** 多喝水", true)).toEqual([["请多休息 多喝水。"], ""]);
});
