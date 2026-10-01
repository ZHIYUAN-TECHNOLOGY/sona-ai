/**
 * The Cloudflare Agents voice protocol (agents/voice, version 1), spoken as its VoiceClient speaks it: one WebSocket to
 * the agent; the phone says hello, then start_call, then streams the mic as binary frames of 16 kHz mono 16-bit PCM
 * (./pcm). The agent answers with JSON events (its status, the patient's words, Sona's answer as it is written) and
 * binary audio, one frame per sentence, MP3 unless audio_config says otherwise; a sentence Sona's voice could not make
 * comes as `sona_say` with no audio instead (apps/server/src/agents/voice.ts). An interrupt stops the answer being
 * spoken. Pure, so bun can test it; the socket and the audio live in ./session.
 */
export const PROTOCOL_VERSION = 1;
// Sona Care's voice agent (SonaVoiceAgent on the Worker) at the Agents SDK's default route; the instance is the signed-in
// account, so each patient talks to their own agent. The one place to change if the Worker routes it elsewhere.
export const agentPath = (instance: string) => `/agents/sona-voice-agent/${encodeURIComponent(instance)}`;
/** `lang`: the app's language, so Sona's own lines (the 999 line, "your care team knows", notices) are in it. */
export const agentUrl = (server: string, instance: string, lang?: string) => `${server.replace(/^http/, "ws")}${agentPath(instance)}${lang ? `?lang=${lang}` : ""}`;

export type Status = "idle" | "listening" | "thinking" | "speaking";
export type AudioFormat = "mp3" | "pcm16" | "wav" | "opus";

export type ServerEvent =
  | { type: "welcome"; protocol_version: number }
  | { type: "status"; status: Status }
  | { type: "audio_config"; format: AudioFormat; sampleRate?: number }
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | { type: "transcript_start"; role: "assistant" }
  | { type: "transcript_delta"; text: string }
  | { type: "transcript_end"; text: string }
  | { type: "transcript_interim"; text: string }
  | { type: "playback_interrupt" }
  | { type: "sona_say"; text: string; reason: "starting" | "slow" | "unavailable" | "notice"; waking?: number }
  | { type: "error"; message: string };

export type ClientMessage =
  | { type: "hello"; protocol_version: number }
  | { type: "start_call"; preferred_format?: AudioFormat }
  | { type: "end_call" }
  | { type: "start_of_speech" }
  | { type: "end_of_speech" }
  | { type: "interrupt" }
  | { type: "text_message"; text: string };

const EVENTS = new Set<string>(["welcome", "status", "audio_config", "transcript", "transcript_start", "transcript_delta", "transcript_end", "transcript_interim", "playback_interrupt", "sona_say", "error"]);

/** A text frame from the agent as an event; undefined for the rest (diagnostics, metrics, the agent's other messages). */
export function parse(data: string): ServerEvent | undefined {
  try {
    const m = JSON.parse(data) as { type?: unknown };
    return typeof m?.type === "string" && EVENTS.has(m.type) ? m as ServerEvent : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The conversation as voice mode shows it. `call`: off, starting (start_call sent) or on (the agent took it).
 * `answer` counts Sona's answers, so each is read once; `spoken` counts the sentences of the current one sent so far,
 * `frames` those that came as audio (the rest came as sona_say), and `done` says the agent has sent all of it (its status
 * went back to listening). `muted`: Sona was cut off, so audio still in flight from that answer is dropped until the next
 * one. `dropped`: the agent ended the call itself (refused it, or its speech recognition failed).
 */
export type Talk = {
  ready: boolean; call: "off" | "starting" | "on"; status: Status;
  heard?: string; said?: string; answer: number; spoken: number; frames: number; written: boolean; done: boolean; muted: boolean;
  format: AudioFormat; rate: number; error?: string; dropped: boolean;
};
export const quiet: Talk = { ready: false, call: "off", status: "idle", answer: 0, spoken: 0, frames: 0, written: true, done: true, muted: false, format: "mp3", rate: 16_000, dropped: false };

/** What the phone did: started or ended the call, cut Sona off, or got a binary audio frame. */
export type Action = ServerEvent | { type: "call" } | { type: "hang_up" } | { type: "barge_in" } | { type: "audio" };

export function reduce(t: Talk, a: Action): Talk {
  switch (a.type) {
    case "welcome": return { ...t, ready: true };
    case "call": return { ...t, call: "starting", error: undefined, dropped: false };
    case "hang_up": return { ...t, call: "off", muted: true };
    case "barge_in": case "playback_interrupt": return { ...t, muted: true };
    case "audio": return t.muted ? t : { ...t, spoken: t.spoken + 1, frames: t.frames + 1 };
    case "sona_say": return t.muted ? t : { ...t, spoken: t.spoken + 1 };
    case "audio_config": return { ...t, format: a.format, rate: a.sampleRate ?? 16_000, call: t.call === "starting" ? "on" : t.call };
    case "status": {
      // The agent says idle as the socket opens, before it takes the call; idle after taking it (or after an error) ends it.
      if (a.status === "idle") return t.call === "on" || (t.call === "starting" && t.error) ? { ...t, status: "idle", call: "off", done: true, dropped: true } : { ...t, status: "idle" };
      return { ...t, status: a.status, call: t.call === "starting" ? "on" : t.call, done: a.status === "listening", muted: a.status === "thinking" ? false : t.muted };
    }
    // The agent clears the interim line with "" as it starts answering; the words stay until the final ones arrive.
    case "transcript_interim": return a.text ? { ...t, heard: a.text } : t;
    case "transcript": return a.role === "user" ? { ...t, heard: a.text } : { ...t, said: a.text, answer: t.answer + 1, spoken: 0, frames: 0, written: true, done: false, muted: false };
    case "transcript_start": return { ...t, said: "", answer: t.answer + 1, spoken: 0, frames: 0, written: false, done: false, muted: false };
    case "transcript_delta": return { ...t, said: (t.said ?? "") + a.text };
    case "transcript_end": return { ...t, said: a.text, written: true };
    case "error": return { ...t, error: a.message };
  }
}

// The agent doesn't end a sentence after these (packages/api/src/voice-agent/answer.ts, ABBREVIATION).
const ABBREVIATION = /\b(dr|mr|mrs|ms|dato|datin|datuk|puan|encik|e\.g|i\.e|etc|vs|no|tab|caps)\.$/i;
/**
 * Sona's answer in sentences, cut exactly where the agent cuts it before each one is spoken (one audio frame each;
 * `sentencesOf` in packages/api/src/voice-agent/answer.ts): after 。！？, at a line end, or after . ! ? and a space
 * (not "Dr."), once the sentence has 10 characters; what is left is the last one. Offsets into `text`, so its words
 * can light up as each frame plays.
 */
export function sentencesOf(text: string) {
  const out: { start: number; end: number }[] = [];
  let from = 0;
  for (let i = 0; i < text.length - 1; i++) {
    const c = text[i]!;
    const ends = c === "\n" || "。！？".includes(c) || (".!?".includes(c) && /\s/.test(text[i + 1]!) && !ABBREVIATION.test(text.slice(from, i + 1)));
    if (!ends || text.slice(from, i + 1).trim().length < 10) continue;
    out.push({ start: from + text.slice(from).search(/\S/), end: from + text.slice(from, i + 1).trimEnd().length });
    from = i + 1;
  }
  const rest = text.slice(from).search(/\S/);
  if (rest >= 0) out.push({ start: from + rest, end: text.trimEnd().length });
  return out;
}

/**
 * What sentence `k` of the `spoken` so far (an audio frame or a sona_say each) speaks: its sentence, and once the
 * answer is all sent, the last one speaks everything left (an agent that sends one frame for a whole answer, or a
 * sentence its voice skipped).
 * ponytail: one frame per sentence, as withVoice's buffered TTS sends them; a streaming TTS (several frames a sentence)
 * would light ahead of the voice, and needs a text marker per frame from the agent.
 */
export function spanOf(text: string, k: number, spoken: number, done: boolean) {
  const s = sentencesOf(text)[k];
  if (!s) return { start: text.length, end: text.length };
  return { start: s.start, end: done && k === spoken - 1 ? text.trimEnd().length : s.end };
}
