import { readReply } from "@sona-ai/domain/check-ins";
import type { Language } from "@sona-ai/domain/discharge";

import { EMERGENCY } from "../baseten-models";
import { LANGUAGE_NAME } from "../chat-models";

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
export type Unit = { type: "unit"; i: number; listen: boolean; text: string; end_of_turn: boolean; ms: number; behind: number };
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
