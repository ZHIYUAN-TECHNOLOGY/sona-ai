// Pure test for the mic-waveform math. No device, no native module.
//   npx tsx lib/audio/waveform.test.ts

import assert from "node:assert/strict";

import { buildWavePath, normalizeAmp, pushRing, rms } from "./waveform";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

// --- rms ------------------------------------------------------------------
ok(rms(new Float32Array([])) === 0, "empty frame → 0");
ok(rms([0, 0, 0]) === 0, "silence → 0");
ok(Math.abs(rms([1, -1, 1, -1]) - 1) < 1e-9, "full-scale square → 1");
ok(rms([0.5, -0.5]) > 0 && rms([0.5, -0.5]) < 1, "mid level in (0,1)");
ok(rms([1, 1]) > rms([0.2, 0.2]), "louder frame → higher rms");

// --- normalizeAmp ---------------------------------------------------------
ok(normalizeAmp(0) === 0, "below floor → 0");
ok(normalizeAmp(0.005) === 0, "at/under noise floor clamps to 0");
ok(normalizeAmp(1) === 1, "loud clamps to 1");
ok(normalizeAmp(0.1) > 0 && normalizeAmp(0.1) <= 1, "speech level maps into (0,1]");
ok(normalizeAmp(0.1) > normalizeAmp(0.05), "monotonic in raw rms");

// --- pushRing -------------------------------------------------------------
{
  const ring = [0, 0, 0];
  pushRing(ring, 0.5, 3);
  ok(ring.length === 3 && ring[2] === 0.5 && ring[0] === 0, "push shifts, keeps size");
  pushRing(ring, 0.9, 3);
  ok(ring.join(",") === "0,0.5,0.9", "oldest drops off the front");
}

// --- buildWavePath --------------------------------------------------------
{
  ok(buildWavePath([], 100, 40) === "", "no points → empty path");
  ok(buildWavePath([0.5], 100, 40) === "", "single point → empty path");

  const amps = [0, 0.3, 0.8, 0.5, 1, 0.2, 0.6, 0.1];
  const d = buildWavePath(amps, 200, 60);
  ok(d.startsWith("M "), "path starts with a moveto");
  ok(d.trim().endsWith("Z"), "path is closed");

  // Every coordinate is finite and within the box (x∈[0,200], y∈[0,60]).
  const nums = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  ok(nums.every((v) => Number.isFinite(v)), "all coords finite");
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  ok(xs.every((x) => x >= 0 && x <= 200), "x within width");
  ok(ys.every((y) => y >= 0 && y <= 60), "y within height");

  // Silence → a flat line down the vertical middle (all y at 30).
  const flat = buildWavePath([0, 0, 0, 0], 100, 60);
  const flatYs = flat.match(/-?\d+(?:\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 1);
  ok(flatYs.every((y) => Math.abs(y - 30) < 0.01), "silence sits on the mid-line");
}

// eslint-disable-next-line no-console
console.log(`waveform: ${checks}/${checks} checks pass`);
