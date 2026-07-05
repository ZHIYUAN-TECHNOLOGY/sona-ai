// Scripted STT source: the locked demo consult's RAW transcript (with PII in
// place), streamed segment-by-segment to simulate live on-device transcription.
// This lets the whole pipeline (redaction, persistence, audit, note, export) run
// and demo TODAY without waiting on the Gate-0 model decision. The real source is
// react-native-executorch `useSpeechToText`; it emits the same {speaker,text}
// shape, so swapping it in (after Gate 0) needs no pipeline change.

import type { Speaker } from "../db/types";

export interface RawSegment {
  speaker: Speaker;
  text: string;
  /** Language spoken, for the "BM + EN" demo beat. */
  lang?: "ms" | "en" | "mixed";
}

// Locked demo consult (docs/superpowers/specs/2026-07-05-locked-demo-consult.md),
// as a good STT would transcribe it (identifiers in written form, BM + EN).
export const LOCKED_RAW_TRANSCRIPT: RawSegment[] = [
  { speaker: "doctor", lang: "mixed", text: "Morning Encik Rahman, apa khabar? How is the cough today?" },
  { speaker: "patient", lang: "ms", text: "Masih ada. Demam dah tiga hari, malam lagi teruk." },
  { speaker: "doctor", lang: "en", text: "Batuk berkahak, or dry?" },
  { speaker: "patient", lang: "mixed", text: "Berkahak, warna kuning. Sikit sesak bila batuk kuat." },
  { speaker: "doctor", lang: "mixed", text: "Any chest pain? Sakit dada bila tarik nafas?" },
  { speaker: "patient", lang: "en", text: "No chest pain, doktor. Just the cough." },
  { speaker: "doctor", lang: "en", text: "Let me confirm your details. IC 580214-05-5321?" },
  { speaker: "patient", lang: "en", text: "Yes, betul. And phone 012-345 6789." },
  { speaker: "doctor", lang: "mixed", text: "Still at No. 12, Jalan Melati, Taman Sri Muda, Shah Alam?" },
  { speaker: "patient", lang: "ms", text: "Sama. Kalau nurse datang, cari Kak Timah kat rumah." },
  { speaker: "doctor", lang: "en", text: "Temperature 38.2, pulse 92, oxygen 97 percent. Throat red, chest clear." },
  { speaker: "doctor", lang: "mixed", text: "Looks viral. Paracetamol one gram four times a day. Review in one week, FBC if not better, come back if very breathless." },
];

export interface Streamer {
  cancel: () => void;
}

/**
 * Emit the scripted transcript segment-by-segment. Returns a canceller. Uses
 * timers (not Date.now) so it is deterministic and cancellable when the screen
 * unmounts. `onDone` fires after the last segment.
 */
export function streamLockedTranscript(
  onSegment: (seg: RawSegment, index: number) => void,
  opts: { intervalMs?: number; onDone?: () => void } = {},
): Streamer {
  const interval = opts.intervalMs ?? 900;
  const timers: ReturnType<typeof setTimeout>[] = [];
  LOCKED_RAW_TRANSCRIPT.forEach((seg, i) => {
    timers.push(
      setTimeout(() => {
        onSegment(seg, i);
        if (i === LOCKED_RAW_TRANSCRIPT.length - 1) opts.onDone?.();
      }, interval * (i + 1)),
    );
  });
  return { cancel: () => timers.forEach(clearTimeout) };
}
