// Pure test for the real audio→diarization core (diarizeWindows). No device, no native
// module: pre-sliced synth windows + the mock embedder stand in for mic + VAD + neural model.
//   npx tsx lib/diarize/liveDiarizer.test.ts

import assert from "node:assert/strict";

import "./mockEmbedder"; // registers the mock embedder as active
import { diarizeWindows } from "./liveDiarizer";
import { mockVoiceprint } from "./mock";
import { synthUtterancePcm } from "./mockAudio";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

void (async () => {
  const spec = [
    { v: "doctor", t: "Any chest pain? Let me examine." },
    { v: "patient", t: "Saya rasa sesak sikit, demam dah tiga hari." },
    { v: "doctor", t: "Prescribe paracetamol one gram, review in one week." },
    { v: "patient", t: "Masih ada batuk, warna kuning." },
    { v: "doctor", t: "Temperature 38.2, throat red, chest clear." },
  ];
  const windows = spec.map((s) => synthUtterancePcm(s.v, s.t));
  const texts = spec.map((s) => s.t);

  // Linguistic + acoustic path (text present).
  const turns = await diarizeWindows(windows, texts);
  ok(turns.length === spec.length, "one turn per window");
  const bySpeaker = spec.map((s, i) => turns[i].speaker === (s.v === "doctor" ? "doctor" : "patient"));
  ok(bySpeaker.every(Boolean), "roles recovered from real windows + text");
  ok(new Set(turns.map((t) => t.cluster)).size === 2, "2 acoustic clusters from windows");

  // Acoustic-only path (no text) with an enrolled doctor voiceprint.
  const doctorVp = mockVoiceprint("doctor", "enrollment sample of the clinician");
  const acoustic = await diarizeWindows(windows, undefined, { doctorVoiceprint: doctorVp, voiceprintWeight: 0.9 });
  const doctorIdx = spec.map((s, i) => (s.v === "doctor" ? i : -1)).filter((i) => i >= 0);
  ok(doctorIdx.every((i) => acoustic[i].speaker === "doctor"), "acoustic-only: enrolled doctor identified without text");

  // Empty input is safe.
  ok((await diarizeWindows([])).length === 0, "empty windows → empty result");

  // eslint-disable-next-line no-console
  console.log(`liveDiarizer: ${checks}/${checks} checks pass`);
})();
