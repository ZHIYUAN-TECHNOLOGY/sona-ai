import { expect, test } from "bun:test";
import { gate, step } from "./gate";

// A 100 ms mic frame at 16 kHz (1600 samples, 3200 bytes) at a given loudness; each its own buffer, to see which are sent.
const frame = (rms, ms = 100) => ({ pcm: new ArrayBuffer(ms * 32), rms, ms });
/** Feeds frames through the gate, `talking` per frame, and returns every step. */
function feed(frames, talking, g = gate()) {
  return frames.map((f, i) => {
    const s = step(g, f, typeof talking === "function" ? talking(i) : talking);
    g = s.gate;
    return s;
  });
}
const silent = s => s.send.length === 1 && new Uint8Array(s.send[0]).every(b => b === 0);

test("with Sona quiet, the mic goes straight to the agent, and where speech starts and ends is marked", () => {
  const frames = [frame(0.1), frame(0.2), ...Array.from({ length: 5 }, () => frame(0.01))];
  const steps = feed(frames, false);
  expect(steps.map(s => s.send[0])).toEqual(frames.map(f => f.pcm));
  expect(steps.map(s => s.mark)).toEqual(["start_of_speech", undefined, undefined, undefined, undefined, undefined, "end_of_speech"]);
  expect(steps.some(s => s.interrupt)).toBe(false);
});

test("while Sona speaks the agent hears silence, and her own echo, however loud, never stops her", () => {
  const echo = [0.3, 0.1, 0.42, 0.2, 0.45, 0.35, 0.4, 0.15, 0.44, 0.3, 0.38, 0.41].map(r => frame(r));
  const steps = feed([...echo, ...echo, ...echo], true);
  expect(steps.every(silent)).toBe(true);
  expect(steps.some(s => s.interrupt)).toBe(false);
});

test("the patient talking over her for 200 ms stops her, and the agent gets their words from just before they began", () => {
  const before = Array.from({ length: 6 }, () => frame(0.03)); // headphones: little echo
  const speech = [frame(0.3), frame(0.3)];
  const steps = feed([...before, ...speech], true);
  expect(steps.slice(0, 7).some(s => s.interrupt)).toBe(false);
  const stop = steps[7];
  expect(stop.interrupt).toBe(true);
  // The last 500 ms held back: three frames before the speech, then the speech itself.
  expect(stop.send).toEqual([before[3].pcm, before[4].pcm, before[5].pcm, speech[0].pcm, speech[1].pcm]);
  expect(stop.mark).toBe("start_of_speech");
});

test("nothing stops her in her first 300 ms, while her echo is learnt", () => {
  const steps = feed([frame(0.3), frame(0.3), frame(0.3)], true);
  expect(steps.some(s => s.interrupt)).toBe(false);
});

test("after she stops, the gate stays shut 800 ms while the room still rings, then opens", () => {
  const frames = [...Array.from({ length: 5 }, () => frame(0.2)), ...Array.from({ length: 9 }, () => frame(0.01))];
  const steps = feed(frames, i => i < 5);
  expect(steps.slice(0, 13).every(silent)).toBe(true);
  expect(steps[13].send).toEqual([frames[13].pcm]);
});

test("the patient answering right after her opens the gate early, with the start of their words", () => {
  const frames = [...Array.from({ length: 5 }, () => frame(0.02)), frame(0.01), frame(0.3), frame(0.3)];
  const steps = feed(frames, i => i < 5);
  expect(steps[7].interrupt).toBe(true); // the caller stops her only if she still has something to say
  expect(steps[7].send).toEqual(frames.slice(3).map(f => f.pcm));
});
