// Pure test for the Whisper hallucination filter. No device.
//   npx tsx lib/pipeline/hallucination.test.ts

import assert from "node:assert/strict";

import { filterHallucinations } from "./hallucination";
import type { SttSegment } from "./sttAlign";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

const seg = (text: string, i = 0): SttSegment => ({ start: i, end: i + 1, text });

// Bracketed non-speech annotations are dropped.
ok(filterHallucinations([seg("(speaking in foreign language)")]).length === 0, "foreign-language annotation dropped");
ok(filterHallucinations([seg("[Music]"), seg("(applause)"), seg("(inaudible)")]).length === 0, "music/applause/inaudible dropped");

// Real speech that merely contains parentheses is kept.
ok(filterHallucinations([seg("the pain (chest) is worse")]).length === 1, "real speech with parens kept");

// YouTube artifacts dropped.
ok(filterHallucinations([seg("Thank you for watching!")]).length === 0, "thanks-for-watching dropped");
ok(filterHallucinations([seg("Subtitles by the Amara.org community")]).length === 0, "subtitles-by dropped");
ok(filterHallucinations([seg("you")]).length === 0, "bare 'you' silence-hallucination dropped");

// Repetition loop collapses to one.
const loop = Array.from({ length: 8 }, (_, i) => seg("I'm from the U.S.", i));
ok(filterHallucinations(loop).length === 1, "8× identical collapses to 1");

// Consecutive duplicates collapse to one (repetition loops).
ok(filterHallucinations([seg("yes", 0), seg("yes", 1)]).length === 1, "consecutive repeat collapses to 1");
ok(filterHallucinations([seg("yes", 0), seg("yes", 1), seg("yes", 2)]).length === 1, "run collapses to 1");

// Real distinct speech survives untouched + trimmed.
const real = filterHallucinations([seg("  How is the cough today?  "), seg("Demam dah tiga hari.")]);
ok(real.length === 2 && real[0].text === "How is the cough today?", "real speech kept + trimmed");

// Non-consecutive duplicates are NOT collapsed (only loops).
ok(filterHallucinations([seg("okay", 0), seg("next", 1), seg("okay", 2)]).length === 3, "separated dups kept");

// eslint-disable-next-line no-console
console.log(`hallucination: ${checks}/${checks} checks pass`);
