import { expect, test } from "bun:test";
import { Playback } from "./queue";

test("chunks play back to back: each starts where the last one ends, or now if the queue ran dry", () => {
  const q = new Playback();
  expect(q.add(0, 2, 10, () => {})).toBe(10);
  expect(q.add(1, 3, 10.5, () => {})).toBe(12); // arrived while the first played: no gap
  expect(q.add(2, 1, 20, () => {})).toBe(20); // arrived late: plays now
});

test("it says which chunk is playing and how far into it, and whether anything still plays", () => {
  const q = new Playback();
  q.add(0, 2, 10, () => {});
  q.add(1, 4, 10, () => {});
  expect(q.at(11)).toEqual({ frame: 0, share: 0.5 });
  expect(q.at(15)).toEqual({ frame: 1, share: 0.75 });
  expect(q.at(16)).toBeUndefined();
  expect(q.busy(15.9)).toBe(true);
  expect(q.busy(16)).toBe(false);
});

test("clearing silences everything still playing or booked at once; chunks already over are left alone", () => {
  const q = new Playback(), stopped = [];
  q.add(0, 2, 10, () => stopped.push(0)); // 10–12 s, over by 13
  q.add(1, 2, 10, () => stopped.push(1)); // 12–14 s
  q.add(2, 2, 13, () => { stopped.push(2); throw new Error("already ended"); }); // 14–16 s
  q.clear();
  expect(stopped).toEqual([1, 2]);
  expect(q.busy(13)).toBe(false);
  expect(q.add(3, 1, 13, () => {})).toBe(13);
});
