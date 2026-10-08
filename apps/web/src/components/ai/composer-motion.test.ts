// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { BEAT_GAP, beatPeriod, fitHeight, heartbeat, RIPPLE_S, ringTarget, ripple } from "./composer-motion";

const rest = { focused: false, near: false, working: false, recording: false, reduced: false };

test("the rim rests still as clear glass; work flows a wave and the voice beats", () => {
  expect(ringTarget(rest)).toEqual({ glow: 0, flow: 0, beat: 0, animate: false });
  const near = ringTarget({ ...rest, near: true }), focused = ringTarget({ ...rest, focused: true });
  const working = ringTarget({ ...rest, focused: true, working: true }), recording = ringTarget({ ...rest, recording: true, working: true });
  for (const r of [near, focused]) expect(r.animate).toBe(false); // focus sends one ripple, the pointer only brightens
  expect(focused.glow).toBeGreaterThan(near.glow);
  expect(working).toMatchObject({ flow: 1, beat: 0, animate: true });
  expect(recording).toMatchObject({ flow: 0, beat: 1, glow: 1, animate: true });
});

test("Reduce Motion keeps the rim still but still brightens it", () => {
  const r = ringTarget({ ...rest, recording: true, reduced: true });
  expect(r.animate).toBe(false);
  expect(r.glow).toBe(1);
});

test("the focus ripple travels round the rim once and settles", () => {
  expect(ripple(0)).toEqual({ at: 0, amp: 0 });
  expect(ripple(RIPPLE_S / 2)!.amp).toBeCloseTo(1);
  expect(ripple(RIPPLE_S * 0.99)!.at).toBeGreaterThan(1);
  expect(ripple(RIPPLE_S)).toBeNull();
});

test("the heartbeat is a lub-dub, then rest, stronger and quicker with the voice", () => {
  const lub = heartbeat(0.05, 1), dub = heartbeat(0.05 + BEAT_GAP, 1), between = heartbeat(0.12, 1), rest = heartbeat(0.6, 1);
  expect(lub).toBeCloseTo(1, 1);
  expect(dub).toBeGreaterThan(0.6);
  expect(between).toBeLessThan(dub);
  expect(rest).toBeLessThan(0.01);
  expect(heartbeat(0.05, 0)).toBeCloseTo(0.35, 1); // a calm beat when silent
  expect(heartbeat(0.05 + beatPeriod(1), 1)).toBeCloseTo(lub); // it repeats
  expect(beatPeriod(0)).toBeGreaterThan(beatPeriod(1));
});

test("the box holds one to six lines, then scrolls", () => {
  expect(fitHeight(0, 20, 20)).toEqual({ height: 40, scrolls: false });
  expect(fitHeight(80, 20, 20)).toEqual({ height: 80, scrolls: false });
  expect(fitHeight(140, 20, 20)).toEqual({ height: 140, scrolls: false });
  expect(fitHeight(400, 20, 20)).toEqual({ height: 140, scrolls: true });
  expect(fitHeight(400, 24, 24, 4)).toEqual({ height: 120, scrolls: true });
});
