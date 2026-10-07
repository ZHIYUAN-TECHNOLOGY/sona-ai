// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { fitHeight, ringTarget } from "./composer-motion";

const rest = { focused: false, near: false, working: false, recording: false, reduced: false };

test("the ring rests still and dim, and wakes for focus, the pointer, work and the voice", () => {
  expect(ringTarget(rest)).toEqual({ glow: 0.2, speed: 0, pulse: 0, animate: false });
  const near = ringTarget({ ...rest, near: true }), focused = ringTarget({ ...rest, focused: true });
  const working = ringTarget({ ...rest, focused: true, working: true }), recording = ringTarget({ ...rest, recording: true, working: true });
  for (const r of [near, focused, working, recording]) expect(r.animate).toBe(true);
  expect(focused.glow).toBeGreaterThan(near.glow);
  expect(working.speed).toBeGreaterThan(focused.speed);
  expect(recording.pulse).toBe(1);
  expect(working.pulse).toBe(0);
});

test("Reduce Motion keeps the ring still but still brightens it", () => {
  const r = ringTarget({ ...rest, focused: true, working: true, reduced: true });
  expect(r.animate).toBe(false);
  expect(r.glow).toBe(0.85);
});

test("the box holds one to six lines, then scrolls", () => {
  expect(fitHeight(0, 20, 20)).toEqual({ height: 40, scrolls: false });
  expect(fitHeight(80, 20, 20)).toEqual({ height: 80, scrolls: false });
  expect(fitHeight(140, 20, 20)).toEqual({ height: 140, scrolls: false });
  expect(fitHeight(400, 20, 20)).toEqual({ height: 140, scrolls: true });
  expect(fitHeight(400, 24, 24, 4)).toEqual({ height: 120, scrolls: true });
});
