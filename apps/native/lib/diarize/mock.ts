import { getSpeakerEmbedder } from "./embedder";
import "./mockEmbedder"; // side effect: registers the mock embedder as active
import { synthUtterancePcm } from "./mockAudio";
import type { DiarUtterance, Voiceprint } from "./types";

// MOCK bridge used by the demo/tests until the real mic+model path is wired. `voiceId` is
// the real speaker, standing in for "the audio of whoever spoke": synthesize a stand-in
// window and run the active embedder. Same-speaker windows cluster; the diarizer never
// sees voiceId. Native-free (no DB import) so pure tests can use it.

/** Voiceprint for a (voiceId, text) pair via synthetic audio + the active embedder. */
export function mockVoiceprint(voiceId: string, text: string): Voiceprint {
  return getSpeakerEmbedder().embed(synthUtterancePcm(voiceId, text));
}

/** Build diarization utterances from scripted segments (voiceId = ground-truth speaker). */
export function mockDiarUtterances(
  segs: { voiceId: string; text: string; lang?: "ms" | "en" | "mixed" }[],
): DiarUtterance[] {
  return segs.map((s) => ({ text: s.text, lang: s.lang, embedding: mockVoiceprint(s.voiceId, s.text) }));
}
