import { embedPcm } from "./mockEmbedder";
import { synthUtterancePcm } from "./mockAudio";
import type { DiarUtterance, Voiceprint } from "./types";

// MOCK bridge used by the demo/tests until the real mic+model path is wired. `voiceId` is
// the real speaker, standing in for "the audio of whoever spoke": synthesize a stand-in
// window and run the mock band-energy embedder synchronously (deterministic, native-free,
// so pure tests can use it). Same-speaker windows cluster; the diarizer never sees voiceId.

/** Voiceprint for a (voiceId, text) pair via synthetic audio + the mock embedder (sync). */
export function mockVoiceprint(voiceId: string, text: string): Voiceprint {
  return embedPcm(synthUtterancePcm(voiceId, text));
}

/** Build diarization utterances from scripted segments (voiceId = ground-truth speaker). */
export function mockDiarUtterances(
  segs: { voiceId: string; text: string; lang?: "ms" | "en" | "mixed" }[],
): DiarUtterance[] {
  return segs.map((s) => ({ text: s.text, lang: s.lang, embedding: mockVoiceprint(s.voiceId, s.text) }));
}
