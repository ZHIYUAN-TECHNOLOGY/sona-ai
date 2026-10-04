import type { Models } from "../models";

/**
 * Sona Care's ears in a live call (apps/server/src/agents/voice.ts). The phone streams 16 kHz PCM16 mono; this
 * finds where the patient's turn ends by itself, then sends that turn as WAV to our fine-tuned Manglish ASR
 * (Models.transcribe, box ②). The ASR reads whole utterances, not a stream, so the end of a turn is found here by
 * loudness: speech, then about 0.7 s of quiet. It has the Agents SDK's Transcriber shape (agents/voice), so
 * withVoice runs one session per call and turns each utterance into an answer turn.
 */

export const RATE = 16_000;
const FRAME = 320; // 20 ms
const FRAME_MS = 20;
/** The half second a turn's start is judged over, the frames kept before it (so the first syllable is not clipped), and the quiet kept after it. */
const WINDOW = 25, PRE_ROLL = 15, TAIL = 10;

/** The calibration knobs: a real phone in a real room is never the ideal on paper. */
export type TurnOptions = {
  /** A 20 ms frame louder than this (dBFS) is speech. */
  speechDb?: number;
  /** Speech within the last half second that starts a turn and interrupts Sona; a cough or a click is shorter. */
  minSpeechMs?: number;
  /** Quiet after speech that ends the turn. */
  quietMs?: number;
  /** A turn is cut (and still sent) at this length. */
  maxMs?: number;
  /** Quiet after speech at which the turn so far is given out early (0: never), so reading it can start before it ends. */
  earlyMs?: number;
};
const DEFAULTS: Required<TurnOptions> = { speechDb: -40, minSpeechMs: 300, quietMs: 700, maxMs: 30_000, earlyMs: 0 };
/** The ear reads a turn from this much quiet on; the turn still ends at quietMs (SonaTranscriber). */
const EARLY_MS = 300;

export type TurnEvent = { type: "start" } | { type: "early"; pcm: Int16Array } | { type: "end"; pcm: Int16Array };

function joined(parts: Int16Array[]) {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
/** A frame's loudness in dBFS (0 is full scale). */
function dbfs(frame: Int16Array) {
  let sum = 0;
  for (const s of frame) sum += s * s;
  return 10 * Math.log10(sum / frame.length / 32768 ** 2 + 1e-12);
}

/** Samples in, turns out. Pure, so tests feed it synthetic PCM. */
export class TurnDetector {
  readonly #o: Required<TurnOptions>;
  #pending = new Int16Array(0);
  /** Between turns: the latest frames, the window plus its pre-roll. */
  #recent: { frame: Int16Array; loud: boolean }[] = [];
  /** In a turn: its frames so far, and the quiet at its end. */
  #turn: Int16Array[] | undefined;
  #quietMs = 0;

  constructor(options: TurnOptions = {}) {
    this.#o = { ...DEFAULTS, ...options };
  }

  push(samples: Int16Array): TurnEvent[] {
    const all = joined([this.#pending, samples]), events: TurnEvent[] = [];
    let at = 0;
    for (; at + FRAME <= all.length; at += FRAME) this.#frame(all.subarray(at, at + FRAME), events);
    this.#pending = all.slice(at);
    return events;
  }

  #frame(frame: Int16Array, events: TurnEvent[]) {
    const loud = dbfs(frame) > this.#o.speechDb;
    if (!this.#turn) {
      this.#recent.push({ frame, loud });
      if (this.#recent.length > WINDOW + PRE_ROLL) this.#recent.shift();
      if (this.#recent.slice(-WINDOW).filter(f => f.loud).length * FRAME_MS < this.#o.minSpeechMs) return;
      this.#turn = this.#recent.map(f => f.frame);
      this.#recent = [];
      this.#quietMs = 0;
      events.push({ type: "start" });
      return;
    }
    this.#turn.push(frame);
    this.#quietMs = loud ? 0 : this.#quietMs + FRAME_MS;
    // A little of the quiet stays: the ASR reads a last word better with its tail than with a hard cut.
    const drop = Math.max(0, this.#quietMs / FRAME_MS - TAIL), sofar = () => joined(this.#turn!.slice(0, this.#turn!.length - drop));
    if (this.#quietMs < this.#o.quietMs && this.#turn.length * FRAME_MS < this.#o.maxMs) {
      // The same samples the turn will end with if nothing more is said.
      if (this.#o.earlyMs && this.#quietMs === this.#o.earlyMs) events.push({ type: "early", pcm: sofar() });
      return;
    }
    events.push({ type: "end", pcm: sofar() });
    this.#turn = undefined;
  }
}

/** 16-bit mono PCM as a WAV file, the format the ASR reads. */
export function wav(pcm: Int16Array, rate = RATE): Uint8Array {
  const out = new Uint8Array(44 + pcm.length * 2), view = new DataView(out.buffer);
  const tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  tag(0, "RIFF"); view.setUint32(4, 36 + pcm.length * 2, true); tag(8, "WAVE");
  tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "data"); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i]!, true);
  return out;
}

/** The SDK's per-call session hooks (agents/voice TranscriberSessionOptions), as far as Sona uses them. */
export type SessionHooks = { onSpeechStart?: (text?: string) => void; onUtterance?: (transcript: string) => void };
/** What the ASR made of a turn: the words from the model, or a fixture with no words (`waking` while box ② starts). */
export type Heard = Awaited<ReturnType<Models["transcribe"]>>;

export class SonaTranscriber {
  constructor(
    private readonly hear: (wav: Uint8Array) => Promise<Heard>,
    /** A turn the ASR could not read: `waking` minutes while it starts, none when the call failed or no model is on. */
    private readonly unheard: (waking?: number) => void = () => {},
    private readonly options: TurnOptions = {},
  ) {}

  createSession(hooks: SessionHooks = {}) {
    // The turn is read from its first 300 ms of quiet, though it ends at 700: when nothing more is said, its words are
    // ready, or nearly, as it ends (the ASR's half second came after the end before, 4 Oct). A patient who goes on
    // makes that reading a waste, and the turn is read again whole.
    const turns = new TurnDetector({ earlyMs: EARLY_MS, ...this.options });
    let odd: Uint8Array | undefined, closed = false, reading = Promise.resolve();
    let ahead: { samples: number; heard: Promise<Heard | undefined> } | undefined;
    const hear = (pcm: Int16Array) => this.hear(wav(pcm)).catch(() => undefined);
    const read = async (pcm: Int16Array, early?: Promise<Heard | undefined>) => {
      const heard = await (early ?? hear(pcm));
      if (closed) return;
      // A model that heard no words (a sigh, the TV) is no turn; no model at all is said out loud.
      if (heard?.source === "model") { if (heard.text.trim()) hooks.onUtterance?.(heard.text.trim()); }
      else this.unheard(heard?.waking);
    };
    return {
      /** Raw PCM16 LE from the phone, in chunks of any size (an odd byte waits for its pair). */
      feed: (chunk: ArrayBuffer) => {
        if (closed) return;
        const fresh = new Uint8Array(chunk), bytes = odd ? new Uint8Array([...odd, ...fresh]) : fresh;
        const even = bytes.length - (bytes.length % 2), view = new DataView(bytes.buffer, bytes.byteOffset, even);
        const samples = new Int16Array(even / 2);
        for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true);
        odd = even < bytes.length ? bytes.slice(even) : undefined;
        for (const event of turns.push(samples)) {
          if (event.type === "start") hooks.onSpeechStart?.();
          else if (event.type === "early") ahead = { samples: event.pcm.length, heard: hear(event.pcm) };
          else {
            const early = ahead?.samples === event.pcm.length ? ahead.heard : undefined;
            ahead = undefined;
            // One at a time, so turns reach the agent in the order they were said.
            reading = reading.then(() => read(event.pcm, early));
          }
        }
      },
      close: () => { closed = true; },
    };
  }
}
