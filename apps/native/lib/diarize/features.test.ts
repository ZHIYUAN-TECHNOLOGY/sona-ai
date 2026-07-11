// Pure test for the log-mel fbank frontend. No device, no native module.
//   npx tsx lib/diarize/features.test.ts
// Verifies real DSP: a pure tone concentrates energy in the mel band covering its
// frequency, higher tones land in higher bands, and the output is deterministic.

import assert from "node:assert/strict";

import { logMelFbank } from "./features";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

const SR = 16000;
const NUM_MEL = 80;

function tone(freq: number, dur = 0.5): Float32Array {
  const n = Math.round(SR * dur);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.sin((2 * Math.PI * freq * i) / SR);
  return a;
}

function poolMean(fb: { data: Float32Array; frames: number; numMel: number }): number[] {
  const v = new Array(fb.numMel).fill(0);
  for (let f = 0; f < fb.frames; f++) for (let m = 0; m < fb.numMel; m++) v[m] += fb.data[f * fb.numMel + m];
  return v.map((x) => x / Math.max(1, fb.frames));
}

function argmax(v: number[]): number {
  let bi = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > v[bi]) bi = i;
  return bi;
}

const fb1 = logMelFbank(tone(1000), { sampleRate: SR, numMel: NUM_MEL });
ok(fb1.frames > 0 && fb1.numMel === NUM_MEL, `produces frames (${fb1.frames} × ${fb1.numMel})`);

const fb3 = logMelFbank(tone(3000), { sampleRate: SR, numMel: NUM_MEL });
const band1 = argmax(poolMean(fb1));
const band3 = argmax(poolMean(fb3));
ok(band3 > band1, `higher tone → higher mel band (1kHz→${band1}, 3kHz→${band3})`);

// Peak band for the 1kHz tone should sit near 1kHz.
const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (m: number) => 700 * (10 ** (m / 2595) - 1);
const melMin = hzToMel(20);
const melMax = hzToMel(SR / 2);
const centerHz = melToHz(melMin + ((melMax - melMin) * (band1 + 1)) / (NUM_MEL + 1));
ok(centerHz > 500 && centerHz < 1800, `1kHz peak band center ~${Math.round(centerHz)}Hz (500–1800)`);

// Deterministic.
const fb1b = logMelFbank(tone(1000), { sampleRate: SR, numMel: NUM_MEL });
ok(fb1.data.length === fb1b.data.length && fb1.data.every((x, i) => x === fb1b.data[i]), "deterministic output");

// eslint-disable-next-line no-console
console.log(`features: ${checks}/${checks} checks pass`);
