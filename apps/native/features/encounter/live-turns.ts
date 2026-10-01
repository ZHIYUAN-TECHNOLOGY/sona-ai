/**
 * Sona Live's turn loop as plain data, so it is tested without a phone. Confirm, then reply: while the mic is on, the
 * clinician's words build up in one draft that survives pauses (a chunk per stretch of speech, each read by Sona speech),
 * and nothing goes to Sona until they send it: Send, or a send phrase said last ("…, submit"). Sona thinks with the mic
 * resting, then replies; listening resumes into a new draft if the mic is still on. The mic button pauses and resumes
 * and keeps the draft.
 */
export type Phase = "listening" | "paused" | "thinking";
export type Turn<R> = { id: number; who: "you"; text: string } | { id: number; who: "sona"; reply: R };
/** A chunk of the draft (speech up to a pause), numbered as recorded: its partial reading until its final one lands. */
export type Piece = { id: number; text: string };
export type Talk<R> = {
  /** Which opening of Live this is: a reply asked in an earlier one never lands here. */
  session: number;
  phase: Phase; mic: boolean; turns: Turn<R>[]; next: number;
  /** Words not yet sent, in the order said. */
  draft: Piece[];
  /** Chunks up to this one never join the draft: recorded before Live opened, or cleared. */
  floor: number;
  /** Sent, waiting for the mic to finish reading; chunks after this one (said after a send phrase) stay out. */
  sending?: number;
  /** The keyboard takes the draft once it is all read (for the page's composer). */
  handoff?: boolean;
};
export type Step<R> =
  | { type: "words"; id: number; text: string } // chunk `id`'s partial reading, or the sample's words so far
  | { type: "heard"; id: number; text: string } // chunk `id`'s final reading ("" when nothing was said)
  | { type: "send" } // Send: Sona's turn starts (the mic rests) and the draft goes once all of it is read
  | { type: "settled" } // the mic has nothing left to read
  | { type: "clear"; upTo: number } // Clear: the draft goes, with every chunk up to `upTo` still being read
  | { type: "keyboard" } // the keyboard takes over: the mic goes off and the draft goes to the composer once read
  | { type: "handed" } // the composer has the draft: it leaves Live's draft
  | { type: "reply"; reply: R; session: number } // Sona's answer, or a notice
  | { type: "mic" } // the mic button
  | { type: "fail"; id?: number; reply?: R }; // the microphone, or chunk `id`'s reading, failed: the mic goes off, with a notice (none repeats one)

export const opened = <R>(session = 0, floor = 0): Talk<R> => ({ session, phase: "listening", mic: true, turns: [], next: 0, draft: [], floor });

// Said last in a chunk, these send the draft; said as a chunk of their own, these clear it. Bare "send" isn't one (too
// often part of the question), and a clear phrase must stand alone: "the lungs are clear" never discards a draft.
const SEND = ["submit", "send it", "hantar", "提交", "发送"], CLEAR = ["clear", "cancel that", "padam", "取消"];
// Closing punctuation and case aside: "Submit." and "提交。" count.
const bare = (text: string) => text.trim().replace(/[\s.,!?…。，！？]+$/, "");

/** The words before a send phrase that ends `text` ("Brief me, submit." → "Brief me"), or undefined. A whole word only: "resubmit" doesn't send. */
export function sendPhrase(text: string) {
  const body = bare(text);
  for (const phrase of SEND) {
    const at = body.length - phrase.length;
    // Chinese has no spaces, so its phrases need no word boundary.
    if (at < 0 || body.slice(at).toLowerCase() !== phrase || (/[a-z]/.test(phrase[0]!) && /[a-z0-9]/i.test(body[at - 1] ?? ""))) continue;
    return body.slice(0, at).replace(/[\s,，、;:]+$/, "");
  }
}
/** A clear phrase said on its own (a chunk of its own, after a pause). */
export const clearPhrase = (text: string) => CLEAR.includes(bare(text).toLowerCase());

/** The draft as one text: chunks joined by a space; a chunk's closing full stop goes when the next carries the sentence on (lower case). */
export const draftText = (draft: Piece[]) => draft.reduce((all, p) => (all ? `${/^[a-z]/.test(p.text) ? all.replace(/\.$/, "") : all} ${p.text}` : p.text), "");

// Chunk `id`'s words in their place in the draft; none (nothing heard) takes the chunk out.
const put = (draft: Piece[], id: number, text: string) => [...draft.filter(p => p.id !== id), ...(text ? [{ id, text }] : [])].sort((a, b) => a.id - b.id);
// Whether chunk `id` still belongs in the draft: not from before Live opened or a clear, and while Sona thinks only for a
// send still waiting on its reading (up to its send phrase).
const counts = <R>(s: Talk<R>, id: number) => id > s.floor && (s.phase !== "thinking" || id <= (s.sending ?? -Infinity));

export function step<R>(s: Talk<R>, e: Step<R>): Talk<R> {
  switch (e.type) {
    case "words": return s.phase === "listening" && counts(s, e.id) && e.text.trim() ? { ...s, draft: put(s.draft, e.id, e.text.trim()) } : s;
    case "heard": {
      if (!counts(s, e.id)) return s;
      // Said on its own, a clear phrase discards the draft so far; what is said next starts a new one.
      if (clearPhrase(e.text)) return { ...s, draft: s.draft.filter(p => p.id > e.id), floor: e.id };
      const before = sendPhrase(e.text);
      if (before === undefined) return { ...s, draft: put(s.draft, e.id, e.text.trim()) };
      // Said last, a send phrase sends the draft up to it (not the phrase itself); anything said after it stays out.
      return { ...s, phase: "thinking", draft: put(s.draft.filter(p => p.id < e.id), e.id, before), sending: e.id };
    }
    case "send": return s.phase === "thinking" ? s : { ...s, phase: "thinking", sending: Infinity };
    case "settled": {
      if (s.sending === undefined) return s;
      const text = draftText(s.draft);
      // Nothing to send after all (the last chunk was silence): the draft stays open.
      if (!text) return { ...s, phase: s.mic ? "listening" : "paused", sending: undefined };
      return { ...s, sending: undefined, draft: [], turns: [...s.turns, { id: s.next, who: "you", text }], next: s.next + 1 };
    }
    case "clear": return s.phase === "thinking" ? s : { ...s, draft: [], floor: Math.max(s.floor, e.upTo) };
    case "keyboard": return { ...s, mic: false, phase: s.phase === "thinking" ? "thinking" : "paused", handoff: true };
    case "handed": return { ...s, draft: [], handoff: undefined };
    case "reply": return e.session !== s.session ? s : { ...s, phase: s.mic ? "listening" : "paused", turns: [...s.turns, { id: s.next, who: "sona", reply: e.reply }], next: s.next + 1 };
    case "mic": {
      const mic = !s.mic;
      // While Sona thinks the mic only decides whether listening resumes after the reply. Either way the draft stays.
      return s.phase === "thinking" ? { ...s, mic } : { ...s, mic, phase: mic ? "listening" : "paused" };
    }
    case "fail": {
      // The microphone failing after it was turned off (a recording still starting) is the clinician's to ignore; a chunk's reading is said even then.
      if (e.id === undefined ? s.phase === "paused" : !counts(s, e.id)) return s;
      // A send waiting on that chunk is called off: the draft stays (the chunk with its partial words), to check and send again.
      const off = e.id !== undefined && s.sending !== undefined;
      const turns = e.reply === undefined ? s.turns : [...s.turns, { id: s.next, who: "sona" as const, reply: e.reply }];
      return { ...s, mic: false, phase: s.phase === "thinking" && !off ? "thinking" : "paused", sending: off ? undefined : s.sending, turns, next: e.reply === undefined ? s.next : s.next + 1 };
    }
  }
}

/** Words of a lead (Sona's first sentence), as the page lays them out. */
export const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);


/** Demo mode's sample streams into the draft as the dock's voice sample does: a word every 170 ms after 380 ms. */
export const sampleAt = (index: number) => 380 + index * 170;
