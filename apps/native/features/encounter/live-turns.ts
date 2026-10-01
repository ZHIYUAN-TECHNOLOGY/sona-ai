/**
 * Sona Live's turn loop as plain data, so it is tested without a phone. The page listens; the clinician's
 * turn ends (a pause, or Send); Sona thinks with the microphone paused, then replies; listening resumes if
 * the microphone is still on. The mic button pauses and resumes without ending the page.
 */
export type Phase = "listening" | "paused" | "thinking";
export type Turn<R> = { id: number; who: "you"; text: string; final: boolean } | { id: number; who: "sona"; reply: R };
export type Talk<R> = { phase: Phase; mic: boolean; turns: Turn<R>[]; next: number };
export type Step<R> =
  | { type: "words"; text: string } // the turn so far (a partial reading, or the sample's next word)
  | { type: "ending" } // the turn ended and its words are being read: Sona is thinking
  | { type: "end"; text: string } // the turn's final words
  | { type: "reply"; reply: R } // Sona's answer, or a notice
  | { type: "drop" } // nothing usable was heard
  | { type: "mic" } // the mic button
  | { type: "fail"; reply: R }; // the microphone or speech model failed: say so, and pause

export const opened = <R>(): Talk<R> => ({ phase: "listening", mic: true, turns: [], next: 0 });

export function step<R>(s: Talk<R>, e: Step<R>): Talk<R> {
  const last = s.turns.at(-1);
  const open = last?.who === "you" && !last.final ? last : undefined;
  // The turn still being heard goes when the mic is turned off, nothing was heard, or the microphone failed.
  const kept = open ? s.turns.slice(0, -1) : s.turns;
  switch (e.type) {
    case "words": {
      const text = e.text.trim();
      if (s.phase !== "listening" || !text) return s;
      return open ? { ...s, turns: [...kept, { ...open, text }] } : { ...s, turns: [...s.turns, { id: s.next, who: "you", text, final: false }], next: s.next + 1 };
    }
    case "ending": return s.phase === "listening" ? { ...s, phase: "thinking" } : s;
    case "end": {
      const text = e.text.trim();
      // Words that arrive after the mic was turned off were never meant to be sent.
      if (s.phase === "paused") return s;
      if (!text) return { ...s, phase: s.mic ? "listening" : "paused", turns: kept };
      return { ...s, phase: "thinking", turns: [...kept, { id: open?.id ?? s.next, who: "you", text, final: true }], next: open ? s.next : s.next + 1 };
    }
    case "reply": return { ...s, phase: s.mic ? "listening" : "paused", turns: [...s.turns, { id: s.next, who: "sona", reply: e.reply }], next: s.next + 1 };
    case "drop": return { ...s, turns: kept };
    case "mic": {
      const mic = !s.mic;
      // While Sona thinks the mic only decides whether listening resumes after the reply.
      if (s.phase === "thinking") return { ...s, mic };
      return mic ? { ...s, mic, phase: "listening" } : { ...s, mic, phase: "paused", turns: kept };
    }
    // An error after the clinician turned the mic off (a recording still starting) is theirs to ignore.
    case "fail": return s.phase === "paused" ? s : { ...s, mic: false, phase: "paused", turns: [...kept, { id: s.next, who: "sona", reply: e.reply }], next: s.next + 1 };
  }
}

/** Words of a lead (Sona's first sentence), as the page lays them out. */
export const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** Claude-style lead: the sentence is laid out muted and one more word turns ink every 35 ms; all at once under Reduce Motion. */
export const WORD_MS = 35;
export const inked = (elapsed: number, words: number, reduced = false) => (reduced ? words : Math.min(words, Math.max(0, Math.floor(elapsed / WORD_MS))));

/** Demo mode's sample turn, timed like the dock's voice sample: a word every 170 ms after 380 ms, then sent on a 1.3 s pause. */
export const sampleAt = (index: number) => 380 + index * 170;
export const sampleEnd = (words: number) => sampleAt(Math.max(0, words - 1)) + 1300;
