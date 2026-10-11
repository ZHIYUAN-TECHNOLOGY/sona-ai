import { readReply } from "@sona-ai/domain/check-ins";
import type { Language } from "@sona-ai/domain/discharge";

import { BRAIN_MODEL, EMERGENCY, answered, boxes, wakingOf, type Baseten } from "../baseten-models";
import { deltas } from "../sse";
import { LANGUAGE_NAME, jsonIn } from "../chat-models";
import { citedSources, leafletsText, unnumbered, type Passage, type Source } from "../leaflets";
/** The question's own language, for the server's voice agent (which has no @sona-ai/domain dependency). */
export { languageOf } from "@sona-ai/domain/language";

/**
 * One answer turn of Sona Care's live voice (withVoice's onTurn). The patient's own record (recordText), the conversation
 * so far and what they just said go to Gemma (box ①), streaming. Gemma answers anything: their own care from the record, any
 * other health or general question from what it knows (user, 1 Oct: no limit on what Sona may answer). Each sentence is
 * handed on as soon as it is written, so Sona starts talking while Gemma is still writing. An emergency sign gets the 999
 * line first, from the keyword floor before Gemma is even asked or from Gemma's own flag; a patient who reports feeling
 * worse is passed to their care team (`escalate`).
 */

/** What withVoice reads from onTurn (AI SDK stream parts): each sentence, then an end, so it is spoken as soon as it is out. */
export type Part = { type: "text-delta"; text: string } | { type: "text-end" };
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
/** Gemma's reply as it is written, or none (`waking` minutes while box ① starts). Aborting `signal` stops it. */
export type ChatStream = (messages: ChatMessage[], signal: AbortSignal) => Promise<{ text: AsyncIterable<string>; model: string } | { waking?: number }>;
/**
 * `source` and `model` are the brain's alone (Gemma). `ear` is who heard the question, when the caller knows (the
 * transcriber's own answer, passed in as `heard`; a typed question has none). The voice is not here: each sentence is
 * spoken after it is handed on, so only the speaker knows (a sentence with no model voice is told by `sona_say`).
 */
export type TurnSummary = {
  grounded: boolean; urgent: boolean; source: "model" | "fixture"; model?: string; waking?: number; ear?: Heard;
  /** The hospital's leaflets the answer used, by title (care.ask's `sources`); empty when it used none, or none were found in time. */
  sources: Source[];
  /** Always 0: every sentence Gemma writes is spoken (founder, 9 Oct), as care.ask's answer is shown whole. Kept so readers still work. */
  withheld: number;
};
/** Who turned the patient's speech into `question`: the ASR model, or a fixture when none did. */
export type Heard = { source: "model"; model: string } | { source: "fixture" };

export type AnswerTurn = {
  question: string;
  /** The conversation before this turn, oldest first (the SDK keeps it). */
  history: { role: "user" | "assistant"; content: string }[];
  /** Her record as Gemma reads it (care-plan's recordText, the text care.ask reads); none when it could not be read. */
  plan?: string;
  /**
   * The hospital's leaflets for this question (../leaflets), found or still being found: Gemma is asked once they are
   * in, which leafletHits bounds (PASSAGES_MS). The 999 line and the care team wait for neither. None: no library.
   */
  passages?: Passage[] | Promise<Passage[]>;
  /** The language of Sona's own lines and of Gemma's answer: the question's own (languageOf) on the voice agent. */
  language: Language;
  /** None: no hosted model. */
  chat?: ChatStream;
  /** Who heard the question, for the turn's summary; none when it was typed. */
  heard?: Heard;
  signal: AbortSignal;
  /** Tells the care team; true once a flagged task is made. */
  escalate(label: "worse" | "urgent"): Promise<boolean>;
  /** How the turn went, once it has all been said. */
  done?(summary: TurnSummary): void;
  /** Where the turn's wait went, once it has all been said (TurnTiming). */
  timed?(timing: TurnTiming): void;
};
/**
 * Milliseconds from the start of the turn (its words are in) to: the leaflets found, Gemma's first piece, its flags
 * line read, and the first sentence handed on to be spoken. What is left of "first audio" after these is the voice's.
 */
export type TurnTiming = { passages?: number; firstPiece?: number; flags?: number; firstSentence?: number };

/** Sona's own lines, worded like Sona Care's app (apps/care/features/assistant/strings.ts). */
export const LINES: Record<Language, {
  call999: string; told: string; unavailable: string; missed: string; off: string;
  starting(minutes: number): string; hearingStarting(minutes: number): string;
}> = {
  en: {
    call999: "If this is happening now, call 999 or go to the nearest emergency department.",
    told: "I've let your care team know.",
    unavailable: "I can't answer right now. Please ask again in a moment, or type your question.",
    missed: "I didn't catch that. Please try again, or type.",
    off: "Speaking to Sona Care isn't switched on yet. Please type instead.",
    starting: n => `Sona Care is starting up, about ${n} min. Please ask again then, or type your question.`,
    hearingStarting: n => `Speaking to Sona Care is starting, about ${n} min. Please type instead, or try again then.`,
  },
  ms: {
    call999: "Jika ini sedang berlaku, hubungi 999 atau pergi ke jabatan kecemasan terdekat.",
    told: "Saya sudah maklumkan pasukan penjagaan anda.",
    unavailable: "Saya tidak dapat menjawab sekarang. Sila tanya lagi sebentar nanti, atau taip soalan anda.",
    missed: "Saya tidak dapat dengar dengan jelas. Sila cuba lagi, atau taip.",
    off: "Bercakap dengan Sona Care belum dihidupkan lagi. Sila taip.",
    starting: n => `Sona Care sedang dimulakan, kira-kira ${n} minit lagi. Sila tanya lagi nanti, atau taip soalan anda.`,
    hearingStarting: n => `Bercakap dengan Sona Care sedang dimulakan, kira-kira ${n} minit lagi. Sila taip, atau cuba lagi nanti.`,
  },
  zh: {
    call999: "如果正在发生，请立即拨打999或前往最近的急诊部。",
    told: "我已经通知了您的医护团队。",
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

// Kept in step with the typed answer's prompt (ANSWER in ../chat-models.ts): the same rules, here as spoken words. Only
// the call says to come back first and that her facts are hers: typed answers already did both (10 Oct gate), and a call
// has no caption to say an answer is general.
const VOICE = `You are Sona Care, a hospital's assistant for its patients, talking with one patient by voice. Answer whatever they ask: their own care, any other health or medicine question, or anything else. For anything about them (their medicines, doses, visits, conditions, allergies, results, what their doctor noted, what they told us), use their record below: it is what the hospital has recorded about them.
Begin every reply with one word on a line of its own: fine, worse or urgent. Then the words to say. Then, on a last line of its own, one line of JSON:
{"inPlan": true | false, "cites": [<leaflet numbers>]}
- The first word is about how the patient says they feel: "urgent" when they say they have an emergency sign now (chest pain, severe breathlessness, confusion, fainting, coughing blood; asking which signs to watch for is a question, not urgent), "worse" if a symptom came back or got worse or a new problem started, otherwise "fine" (a question is fine).
- inPlan is true when your answer uses their record, false when it comes only from a general leaflet or general knowledge.
- cites is the numbers of the hospital's general leaflets your answer used, [] when it used none. The numbers belong in this line only: never say one.
The words to say:
- Plain and kind, as a knowledgeable nurse would say them, at a reading age of about 12, at most 3 short sentences. The first has at most 10 words and answers them directly: it is spoken while you write the rest. No lists, symbols or markdown: they are read aloud.
- In the language the patient spoke (Malay, English or Chinese).
- If urgent, tell them to call 999 now.
- When they say they have a sign on their record's "Come back or call if" list (the fever came back, breathing harder), first tell them to come back to the hospital or call (999 for an emergency, as above), then answer.
- When their record does not hold the answer (what a medicine is, how it works, the usual adult dose, what a condition or a result usually means, how to recover), answer from general medical knowledge and say it is general information. Never refuse, and never answer or end with "ask your doctor or care team" instead of the answer itself.
- Asked how much or how many (puffs, tablets, a child's dose, water), say their record's own number when it holds one (their dose, a fluid limit), otherwise the usual numbers, for their child too: a salbutamol inhaler, usually 1 to 2 puffs when needed, up to 8 in 24 hours on an ordinary day (still wheezy or breathless after it: 1 puff every 30 to 60 seconds up to 10, and call 999 if it does not help); a child's paracetamol, as the usual 120 mg in 5 mL syrup gives it, age 1 to 5: 5 to 10 mL, age 6 to 12: 10 to 20 mL, every 4 to 6 hours, at most 4 doses a day; water, about 2 to 2.5 litres a day (with heart failure or kidney disease, their fluid limit instead).
- For a baby under 1 year, the dose is by their own weight only, never by the age amounts or the 20 kg example; a baby under 3 months with a fever must see a doctor today, who sets the dose: say that first, with no amount for a baby that young.
- When they ask when or how to take a medicine ("eat" or "makan" a medicine means take it), say for each medicine they mean how often and when (before or after food, or only when needed): their own dose and timing from their record when it holds them, otherwise the usual way for that medicine, said as the usual way.
- Asked about a food or drink with their medicines, judge their own medicines by name: when none of theirs is affected, say plainly it is fine with them, with no warning meant for other medicines.
- Asked when their next dose is, or what to do after a missed one: for each medicine they mean whose line in their record gives its times (at 08:00), count from "Now" in their record and say the day and time of its next dose (tonight at 9 pm, tomorrow at 8 am); a line with no times has none to count from: say how often it is taken.
- To book, change or ask for a visit, tell them how in this app: on Doctors, tap Find a doctor (or Book a visit on their Schedule), pick a doctor and a time, then Request appointment; the care team confirms it.
- A fact from their record (an allergy, a medicine, a dose, a date, a result) is theirs, never general information: say it is from their record, and inPlan is true.
- Never say something is in their record when it is not, and never invent a fact about them (a result, a date, a dose they were given).
- When one of the hospital's general leaflets below fits, use it and say it is from the hospital's leaflet. A leaflet is general advice for any patient: never take a fact about this patient (their medicine, dose, date or diagnosis) from a leaflet.`;

/**
 * Sona's "told your care team" line, in every language: only a made task says it (the end of answerTurn), never Gemma.
 * Gemma copied it from an earlier answer in the history (1 Oct, staging: the second call said it twice).
 */
const TOLD = Object.values(LINES).map(l => l.told);

/**
 * The chat for one turn: her record in the system message, then the hospital's leaflets for this question under their
 * own heading (after the record, which is the same every turn of a call: a prefix box ① has already read); the
 * conversation strictly alternating, as chat templates require (an interrupted turn leaves two patient lines in a row);
 * Sona's told line left out, so Gemma does not echo it.
 */
export function messagesFor(turn: Pick<AnswerTurn, "question" | "history" | "plan" | "language"> & { passages?: Passage[] }): ChatMessage[] {
  const said: ChatMessage[] = [];
  for (const m of [...turn.history, { role: "user" as const, content: turn.question }]) {
    // A triage word that reached an earlier answer (TRIAGE_HEAD) is not shown back to Gemma as its own words.
    const last = said.at(-1), content = m.role === "assistant" ? TOLD.reduce((c, t) => c.split(t).join(""), m.content.replace(TRIAGE_HEAD, "")).trim() : m.content;
    if (last?.role === m.role) last.content += `\n${content}`;
    else if (last || m.role === "user") said.push({ role: m.role, content });
  }
  // The turn's language, said as firmly as care.ask says it and last, after her record and the leaflets: "when you cannot
  // tell" before them left English questions answered in Malay, pulled by her Malay leaflet (10 Oct gate: 10 to 16 of 178).
  return [{ role: "system", content: `${VOICE}\n\nPatient's record:\n${turn.plan ?? "None could be read."}\n\n${leafletsText(turn.passages)}\n\nSay the words in ${LANGUAGE_NAME[turn.language]}, whatever language their record or the leaflets are in: translate what you take from them. The first word (fine, worse or urgent) and the JSON stay as asked, in English.` }, ...said];
}

type Flags = { triage?: unknown; inPlan?: unknown; cites?: unknown };
const TRIAGE = ["fine", "worse", "urgent"];
/**
 * The triage word heading a reply, with whatever Gemma sets it off by. It was asked for on a line of its own, but on
 * staging (6 Oct, a long conversation) it also came on the words' own line ("fine You are allergic..."), which was
 * spoken and kept in the conversation, where Gemma copied it. So a reply's first word, when it is one of the three,
 * is always the triage word, whatever follows it.
 */
const TRIAGE_HEAD = /^\s*(fine|worse|urgent)(?![a-z])[\s.:,;!-]*/i;
/**
 * What heads Gemma's reply, and the words after it: undefined while it is still coming, null flags when the reply has
 * none (its first words are words). The head is the triage word on its own line (two tokens, where the whole flags line
 * it used to write first cost every answer a third of a second before its first word, measured 6 Oct); the rest of the
 * flags close the reply (closingAt). A reply that still opens with the whole line of JSON is read as before; Gemma
 * sometimes fences the JSON, and the fence goes with it.
 */
export function flagsOf(text: string, final = false): [Flags | null, string] | undefined {
  const word = TRIAGE_HEAD.exec(text);
  // The word is in, but what follows it has not started: one more piece says where the words begin.
  if (word && !final && word[0].length === text.length) return undefined;
  if (word) return [{ triage: word[1]!.toLowerCase() }, text.slice(word[0].length)];
  const head = /^\s*(?:```(?:json)?\s*)?(\{[\s\S]*?\})[ \t]*(?:\n\s*```)?/.exec(text);
  if (head) return [(jsonIn(head[1]) as Flags | undefined) ?? null, text.slice(head[0].length)];
  const start = text.trim().toLowerCase();
  if (!final && text.length < 400 && (/^\s*(`{1,3}(json)?\s*)?(\{[^}]*)?$/.test(text) || TRIAGE.some(t => t.startsWith(start)))) return undefined;
  return [null, text];
}
/**
 * Where the JSON closing Gemma's reply starts in the words not yet spoken (a fence goes with it): -1 when it has not.
 * It is never read aloud, on a line of its own or not: spoken words hold no brace.
 */
export const closingAt = (text: string) => text.search(/\s*(?:`{1,3}(?:json)?\s*)?\{/);

// "Dr." and the like do not end a sentence.
const ABBREVIATION = /\b(dr|mr|mrs|ms|dato|datin|datuk|puan|encik|e\.g|i\.e|etc|vs|no|tab|caps)\.$/i;
/** As the SDK's sentence chunker (and Sona Care's karaoke, which follows it) counts: a shorter sentence joins the next. */
const MIN_SENTENCE = 10;
/** What is read aloud: no markdown, list marks, stray fence ticks or leaflet numbers, and an end mark, so the next sentence is cut there too. */
function clean(s: string) {
  const t = unnumbered(s).replace(/[*_#`>]+/g, "").replace(/^\s*[-•]\s*/gm, "").replace(/\s+/g, " ").trim();
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

/** How long the end of a turn waits for the care team's task, before finishing without saying it was made. */
const TOLD_WAIT_MS = 8000;
/** The promise's answer, or false if it takes longer than `ms`. */
function within(promise: Promise<boolean>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), ms); })]).finally(() => clearTimeout(timer));
}

export async function* answerTurn(turn: AnswerTurn): AsyncGenerator<Part> {
  const lines = LINES[turn.language], summary: TurnSummary = { grounded: false, urgent: false, source: "fixture", sources: [], withheld: 0, ...turn.heard && { ear: turn.heard } };
  let told: Promise<boolean> | undefined, said = false, passages: Passage[] = [];
  const began = Date.now(), timing: TurnTiming = {}, mark = (step: keyof TurnTiming) => { timing[step] ??= Date.now() - began; };
  const escalate = (label: "worse" | "urgent") => { told ??= turn.escalate(label).catch(() => false); };
  function* say(text: string): Generator<Part> {
    said = true;
    mark("firstSentence");
    yield { type: "text-delta", text };
    yield { type: "text-end" };
  }
  function* urgentFirst(): Generator<Part> {
    if (summary.urgent) return;
    summary.urgent = true;
    yield* say(lines.call999);
  }
  function* sayModel(sentence: string): Generator<Part> {
    // The 999 line already led; Gemma's own call to 999 would only repeat it. The told line is Sona's, said once a task exists.
    if ((summary.urgent && EMERGENCY.test(sentence)) || TOLD.includes(sentence)) return;
    yield* say(sentence);
  }

  // Gemma is asked before anything is said, so its reply is already coming while the 999 line is spoken: at once, or as
  // soon as the leaflets still being found are in (never past PASSAGES_MS; a search that failed offers none).
  const ask = (found: Passage[] = []) => { passages = found; mark("passages"); return turn.chat!(messagesFor({ ...turn, passages }), turn.signal); };
  const reply = !turn.chat ? undefined : turn.passages instanceof Promise ? turn.passages.then(ask, () => ask()) : ask(turn.passages);
  // The keyword floors: the 999 line waits for no model; the narrow urgent words always reach the care team.
  if (callNow(turn.question)) yield* urgentFirst();
  if (readReply(turn.question) === "urgent") escalate("urgent");

  const got = await reply;
  if (turn.signal.aborted) return;
  if (got && "text" in got) {
    summary.source = "model";
    summary.model = got.model;
    // `closing`: the line of JSON after the words, once it has started; nothing from there on is spoken.
    let text = "", flags: Flags | null | undefined, closing: string | undefined;
    try {
      for await (const delta of got.text) {
        if (turn.signal.aborted) return;
        mark("firstPiece");
        if (closing !== undefined) { closing += delta; continue; }
        text += delta;
        if (flags === undefined) {
          const head = flagsOf(text);
          if (!head) continue;
          [flags, text] = head;
          mark("flags");
          // Grounded only when Gemma says so: a reply that leaves inPlan out is not taken to be from her record.
          summary.grounded = flags?.inPlan === true;
          // Only a leaflet that was offered can be a source: a number Gemma made up names nothing.
          summary.sources = citedSources(flags?.cites, passages);
          if (flags?.triage === "urgent") yield* urgentFirst();
          if (flags?.triage === "urgent" || flags?.triage === "worse") escalate(flags.triage);
        }
        const at = closingAt(text);
        if (at >= 0) { closing = text.slice(at); text = text.slice(0, at); }
        const [whole, rest] = sentencesOf(text, closing !== undefined);
        text = rest;
        for (const s of whole) yield* sayModel(s);
      }
      if (flags === undefined) text = flagsOf(text, true)![1];
      for (const s of sentencesOf(text, true)[0]) yield* sayModel(s);
      const closed = closing === undefined ? undefined : jsonIn(closing) as Flags | undefined;
      if (closed?.inPlan !== undefined) summary.grounded = closed.inPlan === true;
      if (closed?.cites !== undefined) summary.sources = citedSources(closed.cites, passages);
    } catch {
      // A reply cut off mid-way keeps what was already said; one cut off before any of it counts as no answer.
      if (turn.signal.aborted) return;
      if (!said) summary.source = "fixture";
    }
  } else summary.waking = got?.waking;

  if (!said) yield* say(summary.waking ? lines.starting(summary.waking) : lines.unavailable);
  if (told && await within(told, TOLD_WAIT_MS) && !turn.signal.aborted) yield* say(lines.told);
  if (!turn.signal.aborted) { turn.done?.(summary); turn.timed?.(timing); }
}

/**
 * An answer's parts, passed through, with what was said of it kept when the patient cuts in. withVoice saves an answer
 * only once it finishes, so a cut-off one left the patient's question with no reply in the conversation; their next line
 * then joined it (messagesFor), the old question first, and Gemma answered the old question again on every later turn
 * (10 Oct: "hot soup?" then "my throat hurts" got the soup answer again). `save` runs as the cut lands, before the next
 * turn reads the conversation. A cut before any sentence still leaves the two patient lines to join, as a patient
 * cut off mid-pause should.
 */
export async function* keepingSaid(parts: AsyncIterable<Part>, signal: AbortSignal, save: (said: string) => void): AsyncGenerator<Part> {
  const said: string[] = [];
  const cut = () => { if (said.length) save(said.join(" ")); };
  signal.addEventListener("abort", cut, { once: true });
  try {
    for await (const part of parts) {
      if (part.type === "text-delta") said.push(part.text);
      yield part;
    }
  } finally {
    signal.removeEventListener("abort", cut);
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
