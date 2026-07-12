import type { DiarizedSpeech } from "../diarize/liveDiarizer";
import type { Speaker } from "../db/types";
import type { RawSegment } from "./mockStt";

// Pure alignment: on-device Whisper gives WHAT was said (text + timestamps); the diarizer
// gives WHO spoke when. This joins them by time overlap → the diarized transcript
// (RawSegment[]) the rest of the pipeline already consumes. Native-free + unit-tested; the
// native transcription lives in ./realStt.

export interface SttSegment {
  start: number;
  end: number;
  text: string;
}

/** The speaker whose diarized region overlaps this STT segment most (unknown if none). */
export function speakerForSegment(seg: { start: number; end: number }, diarized: DiarizedSpeech[]): Speaker {
  let best: Speaker = "unknown";
  let bestOverlap = 0;
  for (const d of diarized) {
    const overlap = Math.max(0, Math.min(seg.end, d.end) - Math.max(seg.start, d.start));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = d.speaker;
    }
  }
  return best;
}

/** Map a Whisper-detected language code to the BM/EN UI tag. */
export function langTag(language?: string): RawSegment["lang"] {
  const l = (language ?? "").toLowerCase();
  if (l === "ms" || l === "malay") return "ms";
  if (l === "en" || l === "english") return "en";
  return "mixed";
}

/** Align STT text segments to diarization speakers by time overlap → diarized transcript. */
export function alignTextToSpeakers(
  sttSegs: SttSegment[],
  diarized: DiarizedSpeech[],
  language?: string,
): RawSegment[] {
  const lang = langTag(language);
  return sttSegs
    .filter((s) => s.text.trim())
    .map((s) => ({ speaker: speakerForSegment(s, diarized), text: s.text.trim(), lang }));
}

/** One transcript line tagged with its ANONYMOUS diarization cluster (before role labeling). */
export interface ClusterSegment {
  cluster: number;
  text: string;
  lang?: RawSegment["lang"];
}

/** The diarized cluster whose region overlaps this STT segment most (-1 if none). */
export function clusterForSegment(seg: { start: number; end: number }, diarized: DiarizedSpeech[]): number {
  let best = -1;
  let bestOverlap = 0;
  for (const d of diarized) {
    const overlap = Math.max(0, Math.min(seg.end, d.end) - Math.max(seg.start, d.start));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = d.cluster;
    }
  }
  return best;
}

/**
 * Align STT text to anonymous diarization CLUSTERS (not roles). The clinician then labels
 * each cluster as Doctor / Patient / Other in the UI — more reliable than guessing.
 */
export function alignTextToClusters(
  sttSegs: SttSegment[],
  diarized: DiarizedSpeech[],
  language?: string,
): ClusterSegment[] {
  const lang = langTag(language);
  return sttSegs
    .filter((s) => s.text.trim())
    .map((s) => ({ cluster: clusterForSegment(s, diarized), text: s.text.trim(), lang }));
}
