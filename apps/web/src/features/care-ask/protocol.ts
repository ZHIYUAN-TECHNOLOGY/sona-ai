import { type Mark, marksOf } from "@sona-ai/domain/answer-parts";

/**
 * The live call's wire format, as the phone speaks it (apps/care/lib/live-voice/protocol.ts, pcm.ts, gate.ts):
 * hello, start_call, then the mic as binary frames of 16 kHz mono 16-bit little-endian PCM. The agent answers with
 * JSON events and binary audio, one MP3 frame per sentence; a sentence without audio comes as `sona_say`. Pure.
 */
export const PROTOCOL_VERSION = 1;
export const RATE = 16_000;
// The phone's thresholds (gate.ts): quietest speech that stops Sona and for how long; where speech starts and ends.
export const INTERRUPT_RMS = 0.05, INTERRUPT_MS = 200, SILENCE_RMS = 0.04, SILENCE_MS = 500;

export type Status = "idle" | "listening" | "thinking" | "speaking";
export type ServerEvent =
  | { type: "welcome"; protocol_version: number }
  | { type: "status"; status: Status }
  | { type: "audio_config"; format: string; sampleRate?: number }
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | { type: "transcript_start"; role: "assistant" }
  | { type: "transcript_delta"; text: string }
  | { type: "transcript_end"; text: string }
  | { type: "transcript_interim"; text: string }
  | { type: "playback_interrupt" }
  | { type: "sona_say"; text: string; reason: string; waking?: number }
  /** How the answer that just ended was made (apps/server/src/agents/live.ts): whether it is urgent, and its parts (answer-parts). */
  | { type: "sona_turn"; urgent?: boolean; marks?: unknown }
  | { type: "error"; message: string };
export type ClientMessage =
  | { type: "hello"; protocol_version: number }
  | { type: "start_call"; preferred_format?: "mp3" }
  | { type: "end_call" | "start_of_speech" | "end_of_speech" | "interrupt" };

const EVENTS = new Set(["welcome", "status", "audio_config", "transcript", "transcript_start", "transcript_delta", "transcript_end", "transcript_interim", "playback_interrupt", "sona_say", "sona_turn", "error"]);

export const agentUrl = (origin: string, instance: string, lang: string) => `${origin.replace(/^http/, "ws")}/agents/sona-voice-agent/${encodeURIComponent(instance)}?lang=${lang}`;
export const encode = (m: ClientMessage) => JSON.stringify(m);
export const hello = encode({ type: "hello", protocol_version: PROTOCOL_VERSION });

/** A text frame from the agent as an event; undefined for anything else it sends. */
export function parse(data: string): ServerEvent | undefined {
  try {
    const m = JSON.parse(data) as { type?: unknown };
    return typeof m?.type === "string" && EVENTS.has(m.type) ? (m as ServerEvent) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What the page shows. `muted`: Sona was cut off, so audio still in flight from that answer is dropped. `urgent` and
 * `marks`: the last answer's, from its `sona_turn` (the 999 card, the words the model coloured), until the next starts.
 */
export type Talk = { status: Status; heard: string; said: string; muted: boolean; error?: string; urgent?: boolean; marks?: Mark[] };
export const quiet: Talk = { status: "idle", heard: "", said: "", muted: false };

export function reduce(t: Talk, e: ServerEvent | { type: "barge_in" }): Talk {
  switch (e.type) {
    case "status": return { ...t, status: e.status, muted: e.status === "thinking" ? false : t.muted };
    case "barge_in": case "playback_interrupt": return { ...t, muted: true };
    case "transcript_interim": return e.text ? { ...t, heard: e.text } : t;
    case "transcript": return e.role === "user" ? { ...t, heard: e.text } : { ...t, said: e.text, muted: false, urgent: undefined, marks: undefined };
    case "transcript_start": return { ...t, said: "", muted: false, urgent: undefined, marks: undefined };
    case "transcript_delta": return { ...t, said: t.said + e.text };
    case "transcript_end": return { ...t, said: e.text };
    case "sona_turn": return { ...t, urgent: e.urgent === true, marks: marksOf(e.marks) };
    case "error": return { ...t, error: e.message };
    default: return t;
  }
}

/** Loudness as root mean square (0 silent, about 0.05 quiet speech). */
export function rms(samples: Float32Array) {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** Float samples (-1…1, clipped) as 16-bit little-endian PCM. */
export function toPcm16(samples: Float32Array): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(samples.length * 2));
  samples.forEach((s, i) => {
    const c = Math.max(-1, Math.min(1, s));
    view.setInt16(i * 2, c < 0 ? c * 0x8000 : c * 0x7fff, true);
  });
  return view.buffer;
}

/**
 * The minimum of the phone's gate: marks where speech starts and ends, and says when the patient has talked over
 * Sona (`interrupt`). ponytail: the browser's echo cancellation replaces the phone's echo follower, warm-up, tail
 * silence and held frames; on a device without it Sona could interrupt herself, port gate.ts then.
 */
export type Gate = { speech: boolean; quietMs: number; loudMs: number };
export const gate = (): Gate => ({ speech: false, quietMs: 0, loudMs: 0 });
export function step(g: Gate, level: number, ms: number, talking: boolean): { gate: Gate; interrupt: boolean; mark?: "start_of_speech" | "end_of_speech" } {
  const loudMs = talking && level > INTERRUPT_RMS ? g.loudMs + ms : 0;
  const interrupt = loudMs >= INTERRUPT_MS;
  const base = { ...g, loudMs: interrupt ? 0 : loudMs };
  if (level > SILENCE_RMS) return { gate: { ...base, speech: true, quietMs: 0 }, interrupt, mark: g.speech ? undefined : "start_of_speech" };
  if (!g.speech) return { gate: base, interrupt };
  const quietMs = g.quietMs + ms;
  return quietMs >= SILENCE_MS ? { gate: { ...base, speech: false, quietMs: 0 }, interrupt, mark: "end_of_speech" } : { gate: { ...base, quietMs }, interrupt };
}
