// Pure test for on-device speaker diarization. No device, no native module.
//   npx tsx lib/diarize/diarize.test.ts
// Runs the locked demo consult through the REAL pipeline (embed → cluster → assign),
// blind to the ground-truth speaker labels, and asserts it recovers doctor vs patient.

import assert from "node:assert/strict";

import { LOCKED_RAW_TRANSCRIPT } from "../pipeline/mockStt";
import { clusterVoiceprints } from "./cluster";
import { diarize, scoreClusters } from "./diarize";
import { mockDiarUtterances, mockVoiceprint } from "./mock";
import { cosineSim } from "../knowledge/vector";
import { scoreUtteranceRole } from "./roleClassifier";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

// --- Embedder separates speakers ---------------------------------------------
// Same speaker, different utterances → high cosine; different speakers → lower.
const drA = mockVoiceprint("doctor", "How is the cough today?");
const drB = mockVoiceprint("doctor", "Any chest pain?");
const ptA = mockVoiceprint("patient", "Demam dah tiga hari.");
const sameSim = cosineSim(drA, drB);
const crossSim = cosineSim(drA, ptA);
ok(sameSim > crossSim, `same-speaker cosine (${sameSim.toFixed(3)}) > cross (${crossSim.toFixed(3)})`);
ok(sameSim > 0.9, `same-speaker voiceprints tight (${sameSim.toFixed(3)} > 0.9)`);

// --- Clustering discovers 2 speakers -----------------------------------------
const utterances = mockDiarUtterances(
  LOCKED_RAW_TRANSCRIPT.map((s) => ({ voiceId: s.speaker, text: s.text, lang: s.lang })),
);
const clusters = clusterVoiceprints(utterances.map((u) => u.embedding));
ok(clusters.centroids.length === 2, `2 acoustic clusters discovered (got ${clusters.centroids.length})`);

// --- Full diarization recovers the roles (no enrollment, linguistic path) -----
const turns = diarize(utterances);
const truth = LOCKED_RAW_TRANSCRIPT.map((s) => s.speaker);
const correct = turns.filter((t, i) => t.speaker === truth[i]).length;
ok(correct === truth.length, `all ${truth.length} roles recovered (got ${correct}/${truth.length})`);
ok(turns.every((t) => t.confidence >= 0 && t.confidence <= 1), "confidence in [0,1]");

// --- Role classifier is bilingual --------------------------------------------
const drCue = scoreUtteranceRole("Paracetamol one gram four times a day. Review in one week.");
ok(drCue.doctor > drCue.patient, "clinical order scores doctor");
const ptCueMs = scoreUtteranceRole("Demam dah tiga hari, malam lagi teruk.");
ok(ptCueMs.patient > ptCueMs.doctor, "Malay symptom report scores patient");

// --- Enrollment path: an enrolled doctor voiceprint still yields correct roles -
const doctorProfile = mockVoiceprint("doctor", "enrollment sample of the clinician voice");
const enrolledTurns = diarize(utterances, { doctorVoiceprint: doctorProfile, voiceprintWeight: 0.7 });
const enrolledCorrect = enrolledTurns.filter((t, i) => t.speaker === truth[i]).length;
ok(enrolledCorrect === truth.length, `enrolled path recovers all roles (${enrolledCorrect}/${truth.length})`);

// --- Third party (nurse) → own cluster, labeled unknown ----------------------
const threeParty = mockDiarUtterances([
  { voiceId: "doctor", text: "Any chest pain?" },
  { voiceId: "patient", text: "Saya rasa sesak sikit." },
  { voiceId: "nurse", text: "Doktor, ubat dah siap." },
  { voiceId: "doctor", text: "Prescribe paracetamol one gram." },
  { voiceId: "patient", text: "Demam dah tiga hari." },
]);
const tp = diarize(threeParty);
ok(new Set(tp.map((t) => t.cluster)).size === 3, "3 parties → 3 clusters");
ok(tp[0].speaker === "doctor" && tp[1].speaker === "patient", "doctor + patient assigned");
ok(tp[2].speaker === "unknown", "third party (nurse) → unknown, not misassigned");

// --- Scores are well-formed ---------------------------------------------------
const scored = scoreClusters(clusters, utterances.map((u) => u.text));
ok(scored.length === 2 && scored.every((s) => s.doctorScore >= 0 && s.patientScore >= 0), "cluster scores well-formed");

// eslint-disable-next-line no-console
console.log(`diarize: ${checks}/${checks} checks pass`);
