// Pure test for the note→speech stripper. No device.
//   npx tsx lib/tts/noteSpeech.test.ts

import assert from "node:assert/strict";

import { noteToSpeech } from "./noteSpeech";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

const md = `## Objective
- **Vitals**: Temp 38.2, pulse 92.
- Throat: red.

## Plan
- Paracetamol 1 gram four times a day, see [ref](http://x).`;

const s = noteToSpeech(md);
ok(!s.includes("#") && !s.includes("*") && !s.includes("`"), "no markdown syntax");
ok(!s.includes("- "), "no bullet dashes");
ok(s.includes("Objective.") && s.includes("Plan."), "headings spoken as labels");
ok(s.includes("Vitals: Temp 38.2, pulse 92."), "bold unwrapped");
ok(s.includes("Paracetamol 1 gram four times a day, see ref."), "link → text, prose kept");
ok(!/\n/.test(s), "single line of prose");
ok(noteToSpeech("") === "" && noteToSpeech("   \n\n") === "", "empty in → empty out");

// eslint-disable-next-line no-console
console.log(`noteSpeech: ${checks}/${checks} checks pass`);
