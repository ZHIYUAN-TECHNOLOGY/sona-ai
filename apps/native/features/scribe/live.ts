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
/** One stretch of a part said by one numbered voice; `from` and `to` are seconds into the part. */
export type VoiceSegment = { voice: number; from: number; to: number; text: string };
/**
 * voice.transcribe's answer: the words, and who said them when the box could tell the voices apart. `memory` is the
 * box's own record of the voices so far (opaque, about 400 KB): sent with the next part, a person keeps their number.
 */
export type Heard = { text: string; segments?: VoiceSegment[]; memory?: string };
export type SendDeps = { read: (uri: string) => Promise<string>; transcribe: (base64: string, memory?: string) => Promise<Heard>; remove: (uri: string) => void; wait: (ms: number) => Promise<void> };
/**
 * One part to the speech model: sent, and on a failure tried once more. Heard, its audio is deleted; failed twice, the
 * audio stays for the clinician's retry, so nothing said is lost and the parts after it carry on.
 */
export async function sendPart(uri: string, deps: SendDeps, onRetry?: () => void, memory?: string): Promise<Heard | { error: unknown }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const heard = await deps.transcribe(await deps.read(uri), memory);
      deps.remove(uri);
      return { ...heard, text: heard.text.trim() };
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

export const UNSURE = " · unsure";
/** Who can be in the room, as the doctor reads them; the server's roles are the same words in lower case. */
export const ROLES = ["Clinician", "Patient", "Family", "Nurse", "Interpreter", "Other"] as const;
export type Role = Lowercase<(typeof ROLES)[number]>;
export const roleLabel = (role: Role) => ROLES.find(label => label.toLowerCase() === role)!;
/** The server's role for a speaker label, only when the label is exactly a role: not unsure, not a voice number, not a name. */
export const roleOf = (label: string): Role | undefined => (ROLES as readonly string[]).includes(label) ? label.toLowerCase() as Role : undefined;
export const voiceLabel = (voice: number) => `Voice ${voice}`;

/** `part-3` is a part's words under its time; `part-3-2` is the second thing a voice said in it. */
const PART_ID = /^part-(\d+)(?:-\d+)?$/;
const partOf = (line: TranscriptLine) => Number(line.id.match(PART_ID)?.[1]);
/** A part's words as a transcript line, its time where the speaker goes until a draft says who said what. */
export const captionLine = (part: Pick<Part, "n" | "from" | "to">, text: string): TranscriptLine => ({ id: `part-${part.n}`, speaker: partRange(part), original: text, english: text });
/**
 * A part as transcript lines: one for each stretch a voice spoke, under the name that voice already has (`names`) or
 * its number; when the box could not tell voices apart, the one caption under the part's time.
 */
export function captionLines(part: Pick<Part, "n" | "from" | "to">, heard: Pick<Heard, "text" | "segments">, names?: Map<number, string>): TranscriptLine[] {
  const said = (heard.segments ?? []).map(s => ({ voice: s.voice, text: s.text.trim() })).filter(s => s.text);
  if (!said.length) return [captionLine(part, heard.text)];
  return said.map(({ voice, text }, k) => ({ id: `part-${part.n}-${k + 1}`, speaker: names?.get(voice) ?? voiceLabel(voice), voice, original: text, english: text }));
}
/** Only the caption under a time: a voiced line is a speaker's turn, which the doctor can relabel. */
export const isCaption = (line: TranscriptLine) => /^part-\d+$/.test(line.id);
/**
 * Adds a part's lines where they were said, in place of any it had: a part retried later goes back in order, not to
 * the end (after a draft's turns, it follows them).
 */
export function placeCaption(transcript: TranscriptLine[], placed: TranscriptLine | TranscriptLine[]) {
  const lines = [placed].flat(), n = lines[0] ? partOf(lines[0]) : NaN;
  const rest = transcript.filter(l => partOf(l) !== n);
  const at = rest.findIndex(l => partOf(l) > n);
  return at < 0 ? [...rest, ...lines] : [...rest.slice(0, at), ...lines, ...rest.slice(at)];
}

/** One person in the room, as the transcript has them. `quote` is the longest thing they said: the doctor knows them by it, the audio being already deleted. */
export type Person = { voice: number; label: string; named: boolean; lines: number; quote: string };
/**
 * The people heard, in the order they first spoke. A voice is named once its label is no longer a number and not
 * unsure; its label is its first line's (naming and merging keep every line of a voice the same).
 */
export function voicesOf(transcript: TranscriptLine[]): Person[] {
  const people = new Map<number, Person>();
  for (const { voice, speaker, original } of transcript) {
    if (voice === undefined) continue;
    const person = people.get(voice);
    if (!person) people.set(voice, { voice, label: speaker.replace(UNSURE, ""), named: !speaker.endsWith(UNSURE) && !/^Voice \d+$/.test(speaker), lines: 1, quote: original });
    else { person.lines++; if (original.length > person.quote.length) person.quote = original; }
  }
  return [...people.values()];
}
/**
 * Where the doctor stands, in one line: the voices heard so far while recording; once stopped, the people and how many
 * still need a name (`open`, the part the screen marks). Nothing until a voice was heard.
 */
export function heardLine(people: Person[], stopped: boolean): { count: string; names?: string; open: number } | undefined {
  const n = people.length, open = people.filter(p => !p.named).length;
  if (!n) return undefined;
  if (!stopped) return { count: `${n} ${n === 1 ? "voice" : "voices"} so far`, open: 0 };
  return { count: `${n} ${n === 1 ? "person" : "people"}`, names: open ? `${open} ${open === 1 ? "needs" : "need"} a name` : "all named", open };
}
/** The labels already settled, by voice: later parts and a new draft keep them rather than go back to numbers. */
export const namesOf = (transcript: TranscriptLine[]) => new Map(voicesOf(transcript).filter(p => p.named).map(p => [p.voice, p.label]));
/** The doctor says who a voice is (a role or a name): every line of that voice takes it. */
export function nameVoice(transcript: TranscriptLine[], voice: number, label: string) {
  const speaker = label.replace(UNSURE, "").trim();
  return speaker ? transcript.map(l => l.voice === voice ? { ...l, speaker } : l) : transcript;
}
/**
 * Two numbers were one person: every line of `from` becomes `into`, under `into`'s label.
 * ponytail: the box's memory still holds them apart, so a later part can bring `from` back and the doctor merges
 * again; keep the merges on Scribe and apply them in captionLines if that happens in real visits.
 */
export function mergeVoice(transcript: TranscriptLine[], from: number, into: number) {
  const speaker = transcript.find(l => l.voice === into)?.speaker ?? voiceLabel(into);
  return transcript.map(l => l.voice === from ? { ...l, voice: into, speaker } : l);
}

/**
 * The draft's turns as the transcript: who said what, the unsure ones marked so the clinician checks them. A voice the
 * doctor already named (`names`) keeps that name; a voice the draft gave no role keeps its number.
 */
export const turnLines = (turns: Turn[], names?: Map<number, string>): TranscriptLine[] => turns.map((turn, i) => ({
  id: `turn-${i + 1}`, original: turn.text, english: turn.text,
  speaker: (turn.voice !== undefined && names?.get(turn.voice))
    || (turn.speaker ? `${roleLabel(turn.speaker)}${turn.sure ? "" : UNSURE}` : turn.voice !== undefined ? voiceLabel(turn.voice) : `Speaker${UNSURE}`),
  ...turn.voice === undefined ? {} : { voice: turn.voice },
}));
/** The transcript as the draft route reads it: the voice when one was heard, a speaker only where a role is settled (not a time, a number, a name, or unsure). */
export const draftLines = (transcript: TranscriptLine[]) => transcript.filter(l => l.original.trim()).map(l => {
  const speaker = roleOf(l.speaker);
  return { text: l.original.trim(), ...speaker ? { speaker } : {}, ...l.voice === undefined ? {} : { voice: l.voice } };
});

/**
 * A draft applied for the doctor's review: its sections become the note's unsaved draft and, when a model wrote it,
 * its turns become the transcript. A sample draft (the captured words) leaves the captions as they are.
 */
export function withDraft(encounter: Encounter, draft: LiveDraft): Encounter {
  const next = editNote(encounter, draft.sections, false);
  return draft.source === "model" ? { ...next, transcript: turnLines(draft.turns, namesOf(encounter.transcript)), transcriptDraft: undefined } : next;
}
/**
 * What an empty note is drafted from. Connected, a recorded consultation goes to note.draft; otherwise the demo drafts
 * on the phone (from its scripted sample until something is captured). The judge build has only the recording: with
 * nothing recorded there is nothing to draft, and the note says so rather than borrow the script.
 */
export const draftFrom = (judge: boolean, live: boolean, lines: number): "recording" | "demo" | "nothing" => live && lines ? "recording" : judge ? "nothing" : "demo";
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
 * Each visit's live parts, the voice memory its last part returned and its last draft's origin, by patient, outside the encounter so the recorder (mounted with
 * the shell) and the screens share them. ponytail: in memory, so a reload forgets parts not yet transcribed (their
 * audio stays in the app's cache, which iOS clears); persist them if reloads mid-consultation matter.
 */
export type Scribe = { parts: Part[]; memory?: string; draft?: Pick<LiveDraft, "source" | "dropped"> & { model?: string; waking?: number; error?: string }; mic?: string };
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
