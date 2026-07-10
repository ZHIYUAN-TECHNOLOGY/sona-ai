// On-device speaker diarization — core types. Diarization answers "who spoke when"
// by turning each utterance's audio window into a VOICEPRINT (speaker embedding),
// clustering the voiceprints into anonymous speakers, then assigning roles
// (doctor / patient / other) from an enrolled clinician voiceprint + linguistic cues.
//
// MOAT: raw audio and voiceprints are biometric PHI — computed and matched entirely
// on-device, never logged, persisted off-device, or transmitted. Only the resulting
// speaker LABELS (doctor/patient) flow downstream, same as the STT text.

import type { Speaker } from "../db/types";

/** A fixed-dimension speaker embedding (unit-normalized). Biometric — device-only. */
export type Voiceprint = Float32Array;

/** One utterance handed to diarization: the STT text + its audio voiceprint. */
export interface DiarUtterance {
  text: string;
  /** Voiceprint of this utterance's audio window (from the active SpeakerEmbedder). */
  embedding: Voiceprint;
  /** Language, carried through for the BM+EN UI (not used by diarization). */
  lang?: "ms" | "en" | "mixed";
}

/** One diarized turn: the utterance plus its anonymous cluster and assigned role. */
export interface DiarTurn {
  text: string;
  lang?: "ms" | "en" | "mixed";
  /** Anonymous acoustic cluster id (0-based) the voiceprint fell into. */
  cluster: number;
  /** Role assigned to this turn's cluster. */
  speaker: Speaker;
  /** Confidence in the role assignment, 0..1 (margin over the runner-up role). */
  confidence: number;
}
