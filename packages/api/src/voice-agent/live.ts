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
    return [...this.said.slice(from), this.#answer ?? ""].some(a => EMERGENCY.test(a));
  }
}
