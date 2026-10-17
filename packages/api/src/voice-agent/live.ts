import { readReply } from "@sona-ai/domain/check-ins";
import type { Language } from "@sona-ai/domain/discharge";

import { EMERGENCY } from "../baseten-models";
import { LANGUAGE_NAME } from "../chat-models";
import { callNow } from "./answer";

/**
 * Sona Care's live voice on MiniCPM-o (box ④, packages/infra/baseten/live): one model hears the patient and answers in
 * Sona's voice, a second at a time, so there is no turn of ours between hearing and speaking. This is the part of its
 * agent (apps/server/src/agents/live.ts) that needs no Worker: the model's brief for the call, and Sona's side of the call
 * turned into the phone's voice events, so Sona Care plays it as it plays today's call (apps/care/lib/live-voice/protocol.ts).
 */

/**
 * The brief stage 1 learnt from (tools/omni-data/build.py SYSTEM, word for word): today's answer rules (answer.ts VOICE)
 * without the JSON flags line, since MiniCPM-o speaks every word it writes.
 */
export function liveBrief(plan: string | undefined, language: Language) {
  return `You are Sona Care, a hospital's assistant for its patients, talking with one patient by voice. Answer whatever they ask: their own care, any other health or medicine question, or anything else. For their own medicines, doses and appointments, use their discharge plan below: it is their record.
How to answer:
- Plain and kind, at a reading age of about 12, at most 3 short sentences. The first has at most 10 words: it is spoken while you write the rest. No lists, symbols or markdown: they are read aloud.
- In the language the patient spoke (Malay, English or Chinese).
- If urgent, tell them to call 999 now.
When they mix languages, or you cannot tell, answer in ${LANGUAGE_NAME[language]}.

Discharge plan:
${plan ?? "None yet: they are still in hospital."}`;
}

/**
 * Words that may report feeling worse (the check-in reader's narrow keywords, as today's call uses when Gemma has not
 * flagged a turn): only these go on to the care team's own reader, so a plain question is not filed as a report.
 */
export const mayReport = (text: string) => readReply(text) !== "fine";

/** 999 as live3 and later say it: numbers in words, so her voice reads them right (tools/omni-voice/spoken.py). */
const SPOKEN_999 = /nine nine nine|sembilan sembilan sembilan|九九九/i;

/** What box ④ itself wrote down of the patient's turn, when it starts to answer (its second ear; data/live.py "transcribe"). */
export type Heard = { type: "heard"; text: string; seconds: number; ms: number };

/**
 * Two ears hear each patient turn (box ②'s ASR and box ④ itself), so a check may fire for either, but once a turn: the
 * other ear's words for a turn that already fired are that turn again, however late they come (box ② may be waking).
 * The same turn is told by its words (half of the shorter one's, as each ear spells a little differently), not by time,
 * so a second symptom said straight after still fires. A turn is remembered for PAIR_MS.
 */
export const PAIR_MS = 3 * 60_000;
export type Ear = "box2" | "box4";
const wordsOf = (text: string) => new Set(text.toLowerCase().match(/[一-鿿]|[\p{L}\p{N}]+/gu) ?? []);
export class Checks {
  #fired: { check: string; ear: Ear; words: Set<string>; at: number }[] = [];

  /** Whether this check may act on these words from this ear; false when the other ear already fired it for this turn. */
  take(check: "call999" | "report", ear: Ear, text: string, now: number) {
    const words = wordsOf(text);
    this.#fired = this.#fired.filter(f => now - f.at < PAIR_MS);
    const twin = this.#fired.findIndex(f => f.check === check && f.ear !== ear
      && [...words].filter(w => f.words.has(w)).length * 2 >= Math.min(words.size, f.words.size));
    if (twin >= 0) {
      this.#fired.splice(twin, 1); // each ear hears a turn once: paired, so the same words said again later fire again
      return false;
    }
    this.#fired.push({ check, ear, words, at: now });
    return true;
  }
}

/** Box ④'s report for one second of the call: listening, or speaking these words; their audio follows as one binary frame. */
export type Unit = { type: "unit"; i: number; listen: boolean; text: string; end_of_turn: boolean; ms: number; behind: number; scripted?: boolean };
export type PhoneEvent =
  | { type: "status"; status: "listening" | "speaking" }
  | { type: "transcript_start"; role: "assistant" }
  | { type: "transcript_delta"; text: string }
  | { type: "transcript_end"; text: string };

/**
 * Sona's answers as the phone shows them: one opens on the first second she speaks, grows by each second's words, and
 * closes at her end of turn. `said` keeps every answer of the call, so the 999 floor can see whether she said it.
 * ponytail: the phone lights her captions sentence by sentence, one audio frame each (spanOf); here a frame is a second,
 * so captions may light ahead of her voice until the phone counts seconds.
 */
export class LiveTurns {
  #answer: string | undefined;
  said: string[] = [];

  unit(u: Pick<Unit, "listen" | "text" | "end_of_turn">): PhoneEvent[] {
    const out: PhoneEvent[] = [];
    if (u.listen) return out; // the model cannot stop mid-answer (MiniCPMODuplex), so listening is between answers
    if (this.#answer === undefined) {
      this.#answer = "";
      out.push({ type: "transcript_start", role: "assistant" }, { type: "status", status: "speaking" });
    }
    if (u.text) {
      this.#answer += u.text;
      out.push({ type: "transcript_delta", text: u.text });
    }
    if (u.end_of_turn) {
      const text = this.#answer.trim();
      this.said.push(text);
      this.#answer = undefined;
      out.push({ type: "transcript_end", text }, { type: "status", status: "listening" });
    }
    return out;
  }

  /** Whether an answer since `from` (an index into `said`), or the one being spoken, sent the patient to 999. */
  sent999(from: number) {
    return [...this.said.slice(from), this.#answer ?? ""].some(a => EMERGENCY.test(a) || SPOKEN_999.test(a));
  }
}

/**
 * Who writes Sona's answers on the live call (SONA_LIVE_BRAIN): box ④ itself ("own"), Gemma for every turn ("gemma"),
 * or box ④ for the turns that are only talk and Gemma for the rest ("router").
 */
export type Brain = "own" | "gemma" | "router";

/** After this much quiet box ④ asks its judge of turns whether the patient has finished (data/live.py, QUIET). */
const TURN_SILENCE_MS = 500;

/**
 * The call's start message to box ④. With Gemma as the brain (SONA_LIVE_BRAIN=gemma) she is held to listening and says
 * only what a `say` gives her. Her own writing-down of the patient comes when she starts an answer of her own, which
 * she then never does, so box ② is the ear; unless she is the ear too (SONA_LIVE_EAR=own), when the box writes each
 * turn down as soon as its judge hears the patient finish.
 */
export const liveStart = (system: string, brain: Brain, transcribe: boolean, ear: "box2" | "own" = "box2") => ({
  type: "start", system, voice: "v1",
  ...brain !== "gemma" ? { transcribe } : ear === "own" ? { transcribe: true, hold: true, turn_silence_ms: TURN_SILENCE_MS } : { transcribe: false, hold: true },
});

/** Words for box ④ to say as written (data/live.py "say"), from its next second, `rate` text tokens a second. No words: she stops there. */
export type Say = { type: "say"; text: string; rate: number };
/**
 * The box's own default, near the pace her voice was trained at (2.7 to 4.2 tokens a second by language).
 * Known limit, not solved here: at 4 a second her scripted voice drops words in Malay and Manglish (the speak test,
 * packages/infra/baseten/live/check.py SAY); the captions still carry every word.
 */
const SAY_RATE = 4;
type Spoken = Pick<Unit, "listen" | "text" | "end_of_turn">;
const CLOSE: Spoken = { listen: false, text: "", end_of_turn: true };

/**
 * The hybrid call (SONA_LIVE_BRAIN=gemma): Gemma writes each answer, a sentence at a time (answer.ts), and box ④ only
 * says it. This keeps the order: which words go to the box when, and which of the box's seconds are that answer on the phone.
 * The box keeps one script, and a new `say` replaces what is left of the last, so one say is with the box at a time.
 * The first sentence goes as soon as it is written (she starts talking while Gemma writes); the sentences written
 * while she says it wait here and go together, as one say, when the box reports that say's end of turn. Gemma writes
 * faster than she speaks, so an answer is two says as a rule, and the pause between says (the box ends a turn with a
 * second of its own) falls between sentences. The box's end of turn is the cue, not a count of words heard back: a
 * unit's text is the box's own decoding, which need not match ours letter for letter.
 * The phone sees one answer: a say's end of turn closes it only when nothing waits and Gemma has finished.
 * Cut off (the patient spoke over her, or asked again): what waits is dropped and an empty say replaces her script,
 * so she stops within a second. Her own end of turn may cross it on the way, and the box then says the empty one as a
 * turn of its own; that late end has no words before it, which tells it from the next say's, and it is left out.
 */
export class Says {
  #waiting: string[] = [];
  /** What is with the box until its end of turn comes back: a say (its words not heard back yet, or heard), or the cut. */
  #with: "say" | "words" | "cut" | undefined;
  /** The answer is open on the phone. */
  #open = false;
  /** Gemma is still writing this answer. */
  #more = false;

  constructor(private readonly send: (say: Say) => void) {}

  /** Nothing of an answer is with the box, waiting, or open on the phone. */
  get idle() {
    return !this.#with && !this.#open && !this.#waiting.length;
  }

  /** A new answer starts, over whatever was left of the last. As `stop`, a unit for the phone may come back. */
  begin() {
    const close = this.stop();
    this.#more = true;
    return close;
  }

  /** The answer's next sentence, in order. */
  sentence(text: string) {
    this.#waiting.push(text);
    this.#next();
  }

  /** Gemma has finished: the answer closes here if she has already said all of it, else at her end of turn. */
  end() {
    this.#more = false;
    return this.#close();
  }

  /** The rest of the answer is not said. Between says there is nothing to stop, so the answer closes here. */
  stop() {
    this.#waiting = [];
    this.#more = false;
    if (this.#with === "say" || this.#with === "words") {
      this.send({ type: "say", text: "", rate: SAY_RATE });
      this.#with = "cut";
    }
    return this.#close();
  }

  /** One of the box's seconds as the phone should see it (LiveTurns.unit); none when it is not part of an answer. */
  unit(u: Spoken): Spoken | undefined {
    if (u.listen) return u;
    const ours = this.#with === "say" || this.#with === "words";
    // One answer in two says: the box starts each without the space between sentences (Chinese has none).
    const text = this.#with === "say" && this.#open && /^[^\s㐀-鿿]/.test(u.text) ? ` ${u.text}` : u.text;
    if (u.text && this.#with === "say") this.#with = "words";
    if (!u.end_of_turn) {
      if (!ours) return undefined; // the rest of an answer that was cut off
      this.#open = true;
      return { ...u, text };
    }
    if (this.#with !== "words" && this.#with !== "cut") return undefined; // the cut's own end, come late
    const cut = this.#with === "cut";
    this.#with = undefined;
    this.#next();
    if (cut) return this.#open ? (this.#open = false, CLOSE) : undefined;
    this.#open = Boolean(this.#with) || this.#more;
    return { ...u, text, end_of_turn: !this.#open };
  }

  #next() {
    if (this.#with || !this.#waiting.length) return;
    this.send({ type: "say", text: this.#waiting.splice(0).join(" ").replace(/([。！？]) /g, "$1"), rate: SAY_RATE });
    this.#with = "say";
  }

  #close() {
    if (this.#with || !this.#open) return undefined;
    this.#open = false;
    return CLOSE;
  }
}

type Line = { role: "user" | "assistant"; content: string };
/** How much of the call Gemma reads back: the last turns (the three-model call's history is the SDK's, kept the same way). */
const HISTORY = 20;
/**
 * The hybrid call so far, for Gemma (answerTurn's `history`). ponytail: kept for the call only, where the three-model
 * call's lasts across calls (the SDK's SQLite); and an answer cut off is kept as written, not as far as she got saying it.
 */
export class CallHistory {
  #lines: Line[] = [];

  /** A patient turn: the conversation before it, and where Sona's answer to it is kept, sentence by sentence. */
  turn(question: string): { history: Line[]; said(sentence: string): void } {
    const history = this.#lines.filter(l => l.content).slice(-HISTORY), answer: Line = { role: "assistant", content: "" };
    this.#lines.push({ role: "user", content: question }, answer);
    return { history, said: sentence => { answer.content += `${answer.content && " "}${sentence}`; } };
  }
}

// Turns that are only talk: a greeting, thanks, a goodbye, "who are you", an "okay". Anything with a number, or a word
// of medicine, a symptom, a dose, a time or a place in it is not.
const TALK = [
  /^(hi|hello|hey|good (morning|afternoon|evening|night)|thanks?( you)?( so much| very much)?|bye|goodbye|see you|ok(ay)?|alright|all right|i see|got it|great|nice|how are you|who are you|what('?s| is) your name|can you hear me)\b/i,
  /^(hai|helo|hello|selamat (pagi|petang|malam|tengah ?hari|tinggal|jalan)|terima kasih|apa khabar|siapa (awak|kamu|anda)|ok(ay)?|baik(lah)?|faham|jumpa lagi|boleh dengar)\b/i,
  /^(你好|您好|早安|早上好|晚安|谢谢|多谢|再见|拜拜|好的?|明白了?|知道了|你是谁|你叫什么|听得到吗)/,
];
const CARE = /\d|\b(medicine|medication|pill|tablet|dose|take|pain|hurt|fever|cough|dizzy|bleed|breath|vomit|rash|wound|appointment|follow|doctor|nurse|clinic|hospital|when|how (much|many|long|often)|should|can i|what (do|should|if)|ubat|pil|biji|dos|makan|sakit|demam|batuk|pening|darah|nafas|muntah|luka|temu ?janji|doktor|jururawat|klinik|bila|berapa|boleh(kah)? saya|patut|perlu)\b|药|片|粒|剂量|吃|痛|疼|烧|咳|晕|血|喘|吐|伤口|复诊|医生|护士|诊所|医院|什么时候|多少|几|可以|应该|怎么/i;
const TALK_WORDS = 8;

/**
 * Whether a turn is only talk, which box ④ answers by itself, at once and in its own way. Everything else is Gemma's:
 * the rule errs that way on purpose, since her own brain slips on doses and numbers (docs/minicpm-o-finetune.md).
 * ponytail: lists of words, not a model; a turn they miss costs only speed (Gemma answers it), never an answer of hers
 * that should have been Gemma's, unless the patient's care is asked about in none of these words.
 */
export const onlyTalk = (text: string) => {
  const said = text.trim().replace(/^[^\p{L}\p{N}]+/u, ""), words = said.split(/\s+/).length, han = (said.match(/[\u3400-\u9fff]/g) ?? []).length;
  return words <= TALK_WORDS && han <= 2 * TALK_WORDS && TALK.some(t => t.test(said)) && !CARE.test(said) && !callNow(said);
};

/**
 * The live call where box ④ answers talk by itself and Gemma answers the rest (SONA_LIVE_BRAIN=router). She is free
 * to answer, as on her own, so a greeting is met at her own speed. What she starts to say is kept here, unheard, until
 * the patient's words come from the ear (box ②, about a second after they stop: before her voice for that second is
 * made): only talk, and what was kept goes to the phone and the rest follows; anything else, and it is left out, she
 * is held to listening (the box's "hold": left free she went on with her own answer, and Gemma's first words came a
 * second later for it, 4.6-5.2 s against 3.3-4.0 s, 4 Oct), and Gemma's answer, given to her to say (Says), takes its place. The box marks the seconds it was given to say
 * (`scripted`); those are never kept back.
 * ponytail: with no words from the ear she stays unheard (as the hybrid call would); and what is kept is bounded.
 */
export class Router {
  #by?: "own" | "gemma";
  #kept: unknown[] = [];
  /** Seconds she has listened since a turn was judged hers: a judgement not used by then is the last turn's. */
  #quiet = 0;

  /** The patient's words: who answers, and what was kept of her own answer to show now when it is hers. */
  heard(text: string): { by: "own" | "gemma"; kept: unknown[] } {
    this.#by = onlyTalk(text) ? "own" : "gemma";
    this.#quiet = 0;
    const kept = this.#by === "own" ? this.#kept : [];
    this.#kept = [];
    return { by: this.#by, kept };
  }

  /** One second of her own words, or its voice: itself when it may go to the phone now, else nothing (kept, or left out). */
  own<T>(item: T, ends = false): T | undefined {
    if (this.#by === "own") {
      this.#quiet = 0;
      if (ends) this.#by = undefined;
      return item;
    }
    if (!this.#by && this.#kept.push(item) > KEPT) this.#kept.shift();
    return undefined;
  }

  /** A second she listened through. */
  listened() {
    if (this.#by === "own" && ++this.#quiet > STALE_S) this.#by = undefined;
  }

  /** Gemma's answer has been said, or cut off: the next turn is judged afresh. */
  done() {
    this.#by = undefined;
    this.#kept = [];
  }
}
const KEPT = 40, STALE_S = 4;
