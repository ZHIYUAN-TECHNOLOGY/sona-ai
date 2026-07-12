// Pure test for STT↔diarization alignment. No device, no native module.
//   npx tsx lib/pipeline/sttAlign.test.ts

import assert from "node:assert/strict";

import type { DiarizedSpeech } from "../diarize/liveDiarizer";
import { alignTextToSpeakers, langTag, speakerForSegment, type SttSegment } from "./sttAlign";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

const diar: DiarizedSpeech[] = [
  { start: 0, end: 2, cluster: 0, speaker: "doctor", confidence: 0.9 },
  { start: 2, end: 4, cluster: 1, speaker: "patient", confidence: 0.9 },
  { start: 4, end: 6, cluster: 2, speaker: "unknown", confidence: 0.5 },
];

// Overlap-based speaker assignment.
ok(speakerForSegment({ start: 0.1, end: 1.8 }, diar) === "doctor", "inside doctor window → doctor");
ok(speakerForSegment({ start: 2.1, end: 3.9 }, diar) === "patient", "patient window");
ok(speakerForSegment({ start: 4.2, end: 5.5 }, diar) === "unknown", "third-party window");
ok(speakerForSegment({ start: 1.5, end: 2.4 }, diar) === "doctor", "straddle → larger overlap wins (0.5>0.4)");
ok(speakerForSegment({ start: 10, end: 11 }, diar) === "unknown", "no overlap → unknown");

// Language tag.
ok(langTag("ms") === "ms" && langTag("en") === "en" && langTag("fr") === "mixed", "language tags");

// Full alignment → RawSegment[].
const stt: SttSegment[] = [
  { start: 0.2, end: 1.8, text: "How is the cough today?" },
  { start: 2.1, end: 3.8, text: "Demam dah tiga hari." },
  { start: 4.3, end: 5.5, text: "Doktor, ubat dah siap." },
  { start: 6, end: 7, text: "   " }, // empty → dropped
];
const rows = alignTextToSpeakers(stt, diar, "en");
ok(rows.length === 3, "empty segment dropped");
ok(rows[0].speaker === "doctor" && rows[1].speaker === "patient" && rows[2].speaker === "unknown", "aligned speakers");
ok(rows.every((r) => r.lang === "en"), "language applied to rows");
ok(rows[0].text === "How is the cough today?", "text preserved + trimmed");

// eslint-disable-next-line no-console
console.log(`sttAlign: ${checks}/${checks} checks pass`);
