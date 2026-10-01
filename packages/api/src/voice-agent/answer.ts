import { readReply } from "@sona-ai/domain/check-ins";
import type { Language } from "@sona-ai/domain/discharge";

import { BRAIN_MODEL, DIAGNOSIS, DOSE_CHANGE, EMERGENCY, answered, boxes, wakingOf, type Baseten } from "../baseten-models";
import { LANGUAGE_NAME, jsonIn } from "../chat-models";

/**
 * One answer turn of Sona Care's live voice (withVoice's onTurn). The patient's own plan, the conversation so far and
 * what they just said go to Gemma (box ①), streaming. AI proposes, rules verify: each sentence is checked before it is
 * spoken (numbers only from the plan, no dose change, no diagnosis words) and handed on at once, so Sona starts talking
 * while Gemma is still writing. An emergency sign gets the 999 line first, from the keyword floor before Gemma is even
 * asked or from Gemma's own flag; a patient who reports feeling worse is passed to their care team (`escalate`).
 */

/** What withVoice reads from onTurn (AI SDK stream parts): each sentence, then an end, so it is spoken as soon as it is out. */
export type Part = { type: "text-delta"; text: string } | { type: "text-end" };
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
/** Gemma's reply as it is written, or none (`waking` minutes while box ① starts). Aborting `signal` stops it. */
export type ChatStream = (messages: ChatMessage[], signal: AbortSignal) => Promise<{ text: AsyncIterable<string>; model: string } | { waking?: number }>;
export type TurnSummary = { grounded: boolean; urgent: boolean; source: "model" | "fixture"; model?: string; waking?: number };

export type AnswerTurn = {
  question: string;
  /** The conversation before this turn, oldest first (the SDK keeps it). */
  history: { role: "user" | "assistant"; content: string }[];
  /** The plan as Gemma reads it (planText); none while the patient is still in hospital. */
  plan?: string;
  /** The language of Sona's own lines, and Gemma's when it cannot tell the patient's. */
  language: Language;
  /** None: no hosted model. */
  chat?: ChatStream;
  signal: AbortSignal;
  /** Tells the care team; true once a flagged task is made. */
  escalate(label: "worse" | "urgent"): Promise<boolean>;
  /** How the turn went, once it has all been said. */
  done?(summary: TurnSummary): void;
};

/** Sona's own lines, worded like Sona Care's app (apps/care/features/assistant/strings.ts). */
export const LINES: Record<Language, {
  call999: string; told: string; check: string; noPlan: string; notHome: string; unavailable: string; missed: string; off: string;
  starting(minutes: number): string; hearingStarting(minutes: number): string;
}> = {
  en: {
    call999: "If this is happening now, call 999 or go to the nearest emergency department.",
    told: "I've let your care team know.",
    check: "Please check that with your care team.",
    noPlan: "Your plan doesn't say. You can send this question to your care team.",
    notHome: "Once you're home from hospital, I can answer from your discharge plan.",
    unavailable: "I can't answer right now. Please ask again in a moment, or type your question.",
    missed: "I didn't catch that. Please try again, or type.",
    off: "Speaking to Sona Care isn't switched on yet. Please type instead.",
    starting: n => `Sona Care is starting up, about ${n} min. Please ask again then, or type your question.`,
    hearingStarting: n => `Speaking to Sona Care is starting, about ${n} min. Please type instead, or try again then.`,
  },
  ms: {
    call999: "Jika ini sedang berlaku, hubungi 999 atau pergi ke jabatan kecemasan terdekat.",
    told: "Saya sudah maklumkan pasukan penjagaan anda.",
    check: "Sila semak perkara itu dengan pasukan penjagaan anda.",
    noPlan: "Pelan anda tidak menyebutnya. Anda boleh hantar soalan ini kepada pasukan penjagaan anda.",
    notHome: "Selepas anda keluar wad, saya boleh menjawab daripada pelan discaj anda.",
    unavailable: "Saya tidak dapat menjawab sekarang. Sila tanya lagi sebentar nanti, atau taip soalan anda.",
    missed: "Saya tidak dapat dengar dengan jelas. Sila cuba lagi, atau taip.",
    off: "Bercakap dengan Sona Care belum dihidupkan lagi. Sila taip.",
    starting: n => `Sona Care sedang dimulakan, kira-kira ${n} minit lagi. Sila tanya lagi nanti, atau taip soalan anda.`,
    hearingStarting: n => `Bercakap dengan Sona Care sedang dimulakan, kira-kira ${n} minit lagi. Sila taip, atau cuba lagi nanti.`,
  },
  zh: {
    call999: "如果正在发生，请立即拨打999或前往最近的急诊部。",
    told: "我已经通知了您的医护团队。",
    check: "这一点请向您的医护团队确认。",
    noPlan: "您的出院计划里没有提到这一点。您可以把这个问题发给您的医护团队。",
    notHome: "您出院回家后，我可以根据您的出院计划回答问题。",
    unavailable: "我现在无法回答。请稍后再问，或者输入您的问题。",
    missed: "我没听清楚。请再说一次，或者打字。",
    off: "Sona Care 的语音功能还没有开启。请先打字。",
    starting: n => `Sona Care 正在启动，大约还要 ${n} 分钟。请稍后再问，或者输入您的问题。`,
    hearingStarting: n => `Sona Care 的语音正在启动，大约还要 ${n} 分钟。请先打字，或稍后再试。`,
  },
};

// The words Sona Care's app treats as "call 999 now" (apps/care/features/assistant/answers.ts), kept in step with it.
const URGENT = /chest\b.{0,20}\b(pain|hurt|tight|pressure)|(pain|tight\w*|pressure) in (my )?chest|breath|faint|pass(ed|ing)?\s*out|collaps|unconscious|bleed|blood(?!\s*(pressure|sugar|tests?|results?))|lips?\b.{0,20}\bblue|blue\b.{0,20}\blips?|seizure|stroke|suicid|kill myself|end my life/i;
const URGENT_MS_ZH = /sakit dada|dada (sakit|sesak|ketat)|sesak nafas|susah (nak )?bernafas|tak boleh bernafas|tidak boleh bernafas|pengsan|pitam|tidak sedarkan diri|berdarah|pendarahan|bibir biru|sawan|strok|angin ahmar|bunuh diri|胸痛|胸口痛|胸闷|呼吸困难|喘不过气|晕倒|昏倒|昏迷|出血|流血|嘴唇发紫|抽搐|中风|自杀|不想活/i;
/** The keyword floor for the 999 line: broad on purpose, since the line says "if this is happening now". */
export const callNow = (text: string) => URGENT.test(text) || URGENT_MS_ZH.test(text) || readReply(text) === "urgent";

const VOICE = `You are Sona Care, a hospital's after-discharge assistant, talking with one patient by voice. Answer ONLY from their discharge plan below.
Begin every reply with one line of JSON, then the words to say on the next line:
{"triage": "fine" | "worse" | "urgent", "inPlan": true | false}
- triage is about how the patient says they feel: "urgent" for an emergency sign (chest pain, severe breathlessness, confusion, fainting, coughing blood), "worse" if a symptom came back or got worse or a new problem started, otherwise "fine" (a question is fine).
- inPlan is false when the plan does not answer what they asked.
The words to say:
- Plain and kind, at a reading age of about 12, at most 3 short sentences. The first has at most 10 words: it is spoken while you write the rest. No lists, symbols or markdown: they are read aloud.
- In the language the patient spoke (Malay, English or Chinese).
- Only what the plan says, with only the numbers written in it. Speak from the plan ("Your plan says..."), never about what illness they have.
- If the plan does not answer it, do not guess: say the plan does not say, and that they can send the question to their care team.
- Never diagnose, never change a dose, and never stop a medicine the plan does not stop. Asked about stopping, changing or still using a medicine, say what its line in the plan says, and that any change is for their care team.
- If urgent, tell them to call 999 now.`;

/**
 * Sona's "told your care team" line, in every language: only a made task says it (the end of answerTurn), never Gemma.
 * Gemma copied it from an earlier answer in the history (1 Oct, staging: the second call said it twice).
 */
const TOLD = Object.values(LINES).map(l => l.told);

/**
 * The chat for one turn: the plan in the system message; the conversation strictly alternating, as chat templates
 * require (an interrupted turn leaves two patient lines in a row); Sona's told line left out, so Gemma does not echo it.
 */
export function messagesFor(turn: Pick<AnswerTurn, "question" | "history" | "plan" | "language">): ChatMessage[] {
  const said: ChatMessage[] = [];
  for (const m of [...turn.history, { role: "user" as const, content: turn.question }]) {
    const last = said.at(-1), content = m.role === "assistant" ? TOLD.reduce((c, t) => c.split(t).join(""), m.content).trim() : m.content;
    if (last?.role === m.role) last.content += `\n${content}`;
    else if (last || m.role === "user") said.push({ role: m.role, content });
  }
  // Malaysians mix languages in one sentence, so a mixed question gets the patient's own app language.
  return [{ role: "system", content: `${VOICE}\nWhen they mix languages, or you cannot tell, answer in ${LANGUAGE_NAME[turn.language]}.\n\nDischarge plan:\n${turn.plan}` }, ...said];
}

type Flags = { triage?: unknown; inPlan?: unknown };
/**
 * The flags line heading Gemma's reply and the words after it: undefined while the line is still coming, null flags
 * when the reply has none (its first words are words). Gemma sometimes fences the JSON; the fence goes with it.
 */
export function flagsOf(text: string, final = false): [Flags | null, string] | undefined {
  const head = /^\s*(?:```(?:json)?\s*)?(\{[\s\S]*?\})[ \t]*(?:\n\s*```)?/.exec(text);
  if (head) return [(jsonIn(head[1]) as Flags | undefined) ?? null, text.slice(head[0].length)];
  if (!final && text.length < 400 && /^\s*(`{1,3}(json)?\s*)?(\{[^}]*)?$/.test(text)) return undefined;
  return [null, text];
}

// "Dr." and the like do not end a sentence.
const ABBREVIATION = /\b(dr|mr|mrs|ms|dato|datin|datuk|puan|encik|e\.g|i\.e|etc|vs|no|tab|caps)\.$/i;
/** As the SDK's sentence chunker (and Sona Care's karaoke, which follows it) counts: a shorter sentence joins the next. */
const MIN_SENTENCE = 10;
/** What is read aloud: no markdown, list marks or stray fence ticks, and an end mark, so the next sentence is cut there too. */
function clean(s: string) {
  const t = s.replace(/[*_#`>]+/g, "").replace(/^\s*[-•]\s*/gm, "").replace(/\s+/g, " ").trim();
  return !t || /[.!?。！？]$/.test(t) ? t : `${t}${/[㐀-鿿]/.test(t) ? "。" : "."}`;
}
/**
 * The whole sentences at the head of `text` and what is left: a sentence ends after . ! ? and a space, after
 * 。！？, or at a line end, once it has 10 characters. `final` takes the rest as the last sentence.
 */
export function sentencesOf(text: string, final = false): [string[], string] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const ends = c === "\n" || "。！？".includes(c) || (".!?".includes(c) && /\s/.test(text[i + 1] ?? "") && !ABBREVIATION.test(text.slice(start, i + 1)));
    if (!ends || text.slice(start, i + 1).trim().length < MIN_SENTENCE) continue;
    const s = clean(text.slice(start, i + 1));
    if (s) out.push(s);
    start = i + 1;
  }
  const rest = text.slice(start);
  if (!final) return [out, rest];
  const last = clean(rest);
  return [last ? [...out, last] : out, ""];
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, once: 1, twice: 2,
  satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, lapan: 8, sembilan: 9, sepuluh: 10,
};
/**
 * The numbers a text states, by value: "08:00" states 8 and 0, "6" and "six" and "enam" are the same 6.
 * ponytail: Chinese number words are not read (一 is in too many words), digits are.
 */
const numbersOf = (s: string) => [...s.toLowerCase().matchAll(/\d+(?:\.\d+)?|[a-z]+/g)]
  .flatMap(([w]) => /\d/.test(w) ? [Number(w)] : w in NUMBER_WORDS ? [NUMBER_WORDS[w]!] : []);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** The plan's dates are written "Mon Oct 12 2026": its month is a number an answer may say ("2026年10月12日"). */
const monthsOf = (plan: string) => [...plan.matchAll(/\b([A-Z][a-z]{2}) \d{1,2} \d{4}\b/g)].map(m => MONTHS.indexOf(m[1]!.toLowerCase()) + 1).filter(Boolean);
/** "Come back if you have chest pain" repeats a warning sign; it does not tell the patient what they have. */
const CONDITION = /\b(if|when|whenever|unless) you (have|get|feel)\b/gi;

/**
 * A sentence Sona may say from this plan: every number in it is one the plan states (or 999), and it changes no dose
 * and names no diagnosis, except inside a line of the plan quoted as written (the safeReply rules in ../baseten-models).
 */
export function safeSentence(sentence: string, plan: string) {
  const quoted = plan.split(/\n|; /).map(l => l.replace(/^-\s*/, "").replace(/^[^:]{1,60}:\s*/, "").trim()).filter(l => l.length >= 8);
  const rest = quoted.reduce((s, line) => s.split(line).join(" "), sentence);
  const known = new Set([...numbersOf(`${plan} 999`), ...monthsOf(plan)]);
  return !DOSE_CHANGE.test(rest) && !DIAGNOSIS.test(rest.replace(CONDITION, " ")) && numbersOf(sentence).every(n => known.has(n));
}

/** How long the end of a turn waits for the care team's task, before finishing without saying it was made. */
const TOLD_WAIT_MS = 8000;
/** The promise's answer, or false if it takes longer than `ms`. */
function within(promise: Promise<boolean>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), ms); })]).finally(() => clearTimeout(timer));
}

export async function* answerTurn(turn: AnswerTurn): AsyncGenerator<Part> {
  const lines = LINES[turn.language], summary: TurnSummary = { grounded: false, urgent: false, source: "fixture" };
  let told: Promise<boolean> | undefined, said = false, steered = false;
  const escalate = (label: "worse" | "urgent") => { told ??= turn.escalate(label).catch(() => false); };
  function* say(text: string): Generator<Part> {
    said = true;
    yield { type: "text-delta", text };
    yield { type: "text-end" };
  }
  function* urgentFirst(): Generator<Part> {
    if (summary.urgent) return;
    summary.urgent = true;
    yield* say(lines.call999);
  }
  function* checked(sentence: string): Generator<Part> {
    // The 999 line already led; Gemma's own call to 999 would only repeat it. The told line is Sona's, said once a task exists.
    if ((summary.urgent && EMERGENCY.test(sentence)) || TOLD.includes(sentence)) return;
    if (safeSentence(sentence, turn.plan ?? "")) return yield* say(sentence);
    // One honest line for whatever was held back, not one per sentence.
    if (!steered) { steered = true; yield* say(lines.check); }
  }

  // Gemma is asked before anything is said, so its reply is already coming while the 999 line is spoken.
  const reply = turn.plan && turn.chat ? turn.chat(messagesFor(turn), turn.signal) : undefined;
  // The keyword floors: the 999 line waits for no model; the narrow urgent words always reach the care team.
  if (callNow(turn.question)) yield* urgentFirst();
  if (readReply(turn.question) === "urgent") escalate("urgent");

  const got = await reply;
  if (turn.signal.aborted) return;
  if (got && "text" in got) {
    summary.source = "model";
    summary.model = got.model;
    let text = "", flags: Flags | null | undefined;
    try {
      for await (const delta of got.text) {
        if (turn.signal.aborted) return;
        text += delta;
        if (flags === undefined) {
          const head = flagsOf(text);
          if (!head) continue;
          [flags, text] = head;
          summary.grounded = flags?.inPlan !== false;
          if (flags?.triage === "urgent") yield* urgentFirst();
          if (flags?.triage === "urgent" || flags?.triage === "worse") escalate(flags.triage);
        }
        const [whole, rest] = sentencesOf(text);
        text = rest;
        for (const s of whole) yield* checked(s);
      }
      if (flags === undefined) text = flagsOf(text, true)![1];
      for (const s of sentencesOf(text, true)[0]) yield* checked(s);
    } catch {
      // A reply cut off mid-way keeps what was already said; one cut off before any of it counts as no answer.
      if (turn.signal.aborted) return;
      if (!said) summary.source = "fixture";
    }
  } else summary.waking = got?.waking;

  if (!said) yield* say(!turn.plan ? lines.notHome : summary.source === "model" ? lines.noPlan : summary.waking ? lines.starting(summary.waking) : lines.unavailable);
  if (told && await within(told, TOLD_WAIT_MS) && !turn.signal.aborted) yield* say(lines.told);
  if (!turn.signal.aborted) turn.done?.(summary);
}

/** The text of an OpenAI-style streamed chat reply (server-sent events), as it arrives. */
export async function* deltas(body: ReadableStream<Uint8Array>, finished?: () => void): AsyncGenerator<string> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      const lines = (pending + read.value).split("\n");
      pending = lines.pop()!;
      for (const line of lines) {
        const data = line.startsWith("data:") ? line.slice(5).trim() : "";
        if (!data || data === "[DONE]") continue;
        const text = (JSON.parse(data) as { choices?: { delta?: { content?: unknown } }[] }).choices?.[0]?.delta?.content;
        if (typeof text === "string" && text) yield text;
      }
    }
    finished?.();
  } finally {
    // An interrupted turn stops reading here: cancelling the body closes the request, so vLLM stops writing.
    await reader.cancel().catch(() => {});
  }
}

/** Gemma in box ① as a `ChatStream`: a cold box is woken and not waited for, so Sona says when it should be ready. */
export function basetenChat(options: Baseten): ChatStream {
  const { send } = boxes(options);
  return async (messages, signal) => {
    try {
      const body = JSON.stringify({ model: BRAIN_MODEL, messages, stream: true, temperature: 0.1, max_tokens: 300 });
      const res = await send("brain", "/v1/chat/completions", body, "application/json", 30_000, signal);
      return { text: deltas(res.body!, () => answered("brain")), model: BRAIN_MODEL };
    } catch {
      return wakingOf("brain");
    }
  };
}
