// Pure test for the MFCC speaker embedder + per-embedder clustering threshold. No device.
//   npx tsx lib/diarize/mfcc.test.ts

import assert from "node:assert/strict";

import { cosineSim } from "../knowledge/vector";
import { registerSpeakerEmbedder } from "./embedder";
import { diarizeWindows } from "./liveDiarizer";
import { embedPcmMfcc } from "./mfcc";
import { mfccSpeakerEmbedder } from "./mfccEmbedder";
import { synthUtterancePcm } from "./mockAudio";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

// Make MFCC the active embedder for diarizeWindows (its threshold is 0.99, not 0.9).
registerSpeakerEmbedder(mfccSpeakerEmbedder);
ok(mfccSpeakerEmbedder.threshold === 0.99, "MFCC carries its own high threshold");

void (async () => {
  // MFCC separates speakers: same-speaker closer than cross-speaker.
  const dr1 = embedPcmMfcc(synthUtterancePcm("doctor", "How is the cough today?"));
  const dr2 = embedPcmMfcc(synthUtterancePcm("doctor", "Any chest pain?"));
  const pt1 = embedPcmMfcc(synthUtterancePcm("patient", "Demam dah tiga hari."));
  ok(cosineSim(dr1, dr2) > cosineSim(dr1, pt1), "same-speaker MFCC closer than cross-speaker");

  // diarizeWindows uses the ACTIVE embedder's threshold (0.99). This is the point: at the
  // band-energy default (0.9) MFCC's tight cosines would merge to ONE cluster; with the
  // embedder-specific threshold it splits into two. Proves per-embedder threshold works.
  const spec = [
    { v: "doctor", t: "Any chest pain? Let me examine." },
    { v: "patient", t: "Saya rasa sesak, demam dah tiga hari." },
    { v: "doctor", t: "Prescribe paracetamol one gram, review in one week." },
    { v: "patient", t: "Masih ada batuk, warna kuning." },
  ];
  const windows = spec.map((s) => synthUtterancePcm(s.v, s.t));
  const turns = await diarizeWindows(windows, spec.map((s) => s.t));
  ok(new Set(turns.map((t) => t.cluster)).size === 2, "MFCC threshold → 2 clusters (not merged)");
  ok(
    spec.every((s, i) => turns[i].speaker === (s.v === "doctor" ? "doctor" : "patient")),
    "roles recovered with MFCC embedder",
  );

  // eslint-disable-next-line no-console
  console.log(`mfcc: ${checks}/${checks} checks pass`);
})();
