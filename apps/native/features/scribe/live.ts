import type { AppRouterClient } from "@sona-ai/api/routers/index";
import type { Encounter, TranscriptLine } from "@/features/encounter/types";
import { SPEECH_DB } from "@/features/live/turn";
import { buildDraft, editNote, elapsedLabel, readNoteSections } from "./model";

/**
 * The live scribe's logic, kept free of the recorder so it can be tested: when to cut the recording into parts, how a
 * part is sent and retried, and how captions and the draft's turns become the visit's transcript. The recorder itself
 * is ./live-recorder; the screens read the parts from `scribeStore`.
 */
export type LiveDraft = Awaited<ReturnType<AppRouterClient["note"]["draft"]>>;
type Turn = LiveDraft["turns"][number];

/*
 * About 30 s a part, cut at the first pause after 25 s so no word is split, and by 36 s whatever is being said:
 * voice.transcribe takes about 40 s of 16 kHz audio (MAX_AUDIO_BASE64). A pause is 0.3 s of quiet.
 */
export const SOFT_MS = 25_000, HARD_MS = 36_000, PAUSE_MS = 300;
export const cutNow = ({ elapsed, quietFor }: { elapsed: number; quietFor: number }) => elapsed >= HARD_MS || (elapsed >= SOFT_MS && quietFor >= PAUSE_MS);
/**
 * Quiet: under the dock's speech level, or within 10 dB of the quietest the room has been, whichever is lower, so a
 * noisy clinic still has pauses. `floor` is the lowest level heard so far (dBFS; -160 is the recorder not metering yet).
 */
export const isQuiet = (level: number, floor: number) => level < Math.min(SPEECH_DB, floor + 10);

/** What the recorder has heard of the current part: the last 3 s of levels (one a tenth of a second), and since when it has been quiet. */
export type Listening = { levels: number[]; quietSince?: number };
/** One level reading (ten a second): whether to cut the part now, and what has been heard, for the next reading. */
export function listen(heard: Listening, { elapsed, level, now }: { elapsed: number; level: number; now: number }): { cut: boolean; heard: Listening } {
  const levels = [...heard.levels.slice(-29), level];
  const metered = levels.filter(l => l > -120); // -160: the recorder is not metering yet
  const quietSince = isQuiet(level, metered.length ? Math.min(...metered) : Infinity) ? heard.quietSince ?? now : undefined;
  return { cut: cutNow({ elapsed, quietFor: quietSince === undefined ? 0 : now - quietSince }), heard: { levels, quietSince } };
}

export type Part = {
  /** 1, 2, 3… in recording order; `from` and `to` are seconds into the consultation. */
  n: number; from: number; to: number;
  status: "sending" | "retrying" | "failed" | "done";
  /** The part's audio, kept on the phone only while it is not yet transcribed. */
  uri?: string;
  /** Why it failed: the server's words, or the speech model starting (`minutes` when known). */
  error?: string; starting?: { minutes?: number };
};
export const partRange = (part: Pick<Part, "from" | "to">) => `${elapsedLabel(part.from)}–${elapsedLabel(part.to)}`;

export const RETRY_MS = 2_000;
export type SendDeps = { read: (uri: string) => Promise<string>; transcribe: (base64: string) => Promise<string>; remove: (uri: string) => void; wait: (ms: number) => Promise<void> };
/**
 * One part to the speech model: sent, and on a failure tried once more. Heard, its audio is deleted; failed twice, the
 * audio stays for the clinician's retry, so nothing said is lost and the parts after it carry on.
 */
export async function sendPart(uri: string, deps: SendDeps, onRetry?: () => void): Promise<{ text: string } | { error: unknown }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const text = await deps.transcribe(await deps.read(uri));
      deps.remove(uri);
      return { text: text.trim() };
    } catch (error) {
      if (attempt) return { error };
      onRetry?.();
      await deps.wait(RETRY_MS);
    }
  }
}

/** voice.transcribe's refusal while no speech model answers (SPEECH_OFF): starting, with the minutes when the server knows them. */
export function speechOff(error: unknown): { starting: boolean; minutes?: number } | undefined {
  const { message, data } = (error ?? {}) as { message?: unknown; data?: { code?: unknown } };
  if (data?.code !== "SPEECH_OFF") return undefined;
  const text = String(message ?? "");
  return { starting: /starting/i.test(text), minutes: Number(text.match(/about (\d+) min/)?.[1]) || undefined };
}

const PART_ID = /^part-(\d+)$/;
/** A part's words as a transcript line, its time where the speaker goes until a draft says who said what. */
export const captionLine = (part: Pick<Part, "n" | "from" | "to">, text: string): TranscriptLine => ({ id: `part-${part.n}`, speaker: partRange(part), original: text, english: text });
export const isCaption = (line: TranscriptLine) => PART_ID.test(line.id);
/** Adds a caption where it was said: a part retried later goes back in order, not to the end (after a draft's turns, it follows them). */
export function placeCaption(transcript: TranscriptLine[], line: TranscriptLine) {
  const n = Number(line.id.match(PART_ID)?.[1]);
  const rest = transcript.filter(l => l.id !== line.id);
  const at = rest.findIndex(l => Number(l.id.match(PART_ID)?.[1] ?? -1) > n);
  return at < 0 ? [...rest, line] : [...rest.slice(0, at), line, ...rest.slice(at)];
}

export const UNSURE = " · unsure";
const LABEL = { clinician: "Clinician", patient: "Patient" } as const;
/** The draft's turns as the transcript: who said what, the unsure ones marked so the clinician checks them. */
export const turnLines = (turns: Turn[]): TranscriptLine[] => turns.map((turn, i) => ({
  id: `turn-${i + 1}`, original: turn.text, english: turn.text,
  speaker: turn.speaker ? `${LABEL[turn.speaker]}${turn.sure ? "" : UNSURE}` : `Speaker${UNSURE}`,
}));
/** The transcript as the draft route reads it: a speaker only where one is settled (not a time, not unsure). */
export const draftLines = (transcript: TranscriptLine[]) => transcript.filter(l => l.original.trim()).map(l => ({
  text: l.original.trim(),
  ...l.speaker === "Clinician" ? { speaker: "clinician" as const } : l.speaker === "Patient" ? { speaker: "patient" as const } : {},
}));

/**
 * A draft applied for the doctor's review: its sections become the note's unsaved draft and, when a model wrote it,
 * its turns become the transcript. A sample draft (the captured words) leaves the captions as they are.
 */
export function withDraft(encounter: Encounter, draft: LiveDraft): Encounter {
  const next = editNote(encounter, draft.sections, false);
  return draft.source === "model" ? { ...next, transcript: turnLines(draft.turns), transcriptDraft: undefined } : next;
}
/** No draft from the server (offline, or refused): the captured words stand as the note's history, so the doctor can still write it now. */
export const withCapturedDraft = (encounter: Encounter) => editNote(encounter, readNoteSections(buildDraft(encounter.transcript)), false);
/** What the note screen labels a draft by: the model that wrote it, or why it is the captured words. */
export const draftOrigin = (draft: LiveDraft): NonNullable<Scribe["draft"]> => ({
  source: draft.source, dropped: draft.dropped,
  ...draft.source === "model" ? { model: draft.model } : draft.waking ? { waking: draft.waking } : {},
});

/** "Part 3 (01:00–01:30) wasn't transcribed." or "2 parts weren't transcribed: 01:00–01:30, 02:00–02:30." */
export function failedLine(failed: Part[]) {
  if (!failed.length) return "";
  return failed.length === 1 ? `Part ${failed[0]!.n} (${partRange(failed[0]!)}) wasn't transcribed.` : `${failed.length} parts weren't transcribed: ${failed.map(partRange).join(", ")}.`;
}

/**
 * Each visit's live parts and its last draft's origin, by patient, outside the encounter so the recorder (mounted with
 * the shell) and the screens share them. ponytail: in memory, so a reload forgets parts not yet transcribed (their
 * audio stays in the app's cache, which iOS clears); persist them if reloads mid-consultation matter.
 */
export type Scribe = { parts: Part[]; draft?: Pick<LiveDraft, "source" | "dropped"> & { model?: string; waking?: number; error?: string }; mic?: string };
const EMPTY: Scribe = { parts: [] };
const scribes = new Map<string, Scribe>();
const listeners = new Set<() => void>();
export const scribeStore = {
  get: (patientId: string | undefined) => (patientId && scribes.get(patientId)) || EMPTY,
  update(patientId: string, change: (current: Scribe) => Scribe) { scribes.set(patientId, change(scribeStore.get(patientId))); listeners.forEach(l => l()); },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
/** One part changed in place. */
export const withPart = (n: number, change: Partial<Part>) => (s: Scribe): Scribe => ({ ...s, parts: s.parts.map(p => p.n === n ? { ...p, ...change } : p) });
