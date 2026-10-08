// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { BEAT_GAP, beatPeriod, fades, fitHeight, heartbeat, RIPPLE_S, ringTarget, ripple, stacks } from "./composer-motion";

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

test("the text grows from one line to its max height, then scrolls", () => {
  expect(fitHeight(0, 40, 160)).toEqual({ height: 40, scrolls: false });
  expect(fitHeight(100, 40, 160)).toEqual({ height: 100, scrolls: false });
  expect(fitHeight(160, 40, 160)).toEqual({ height: 160, scrolls: false });
  expect(fitHeight(400, 40, 160)).toEqual({ height: 160, scrolls: true });
});

test("the text takes its own row by its words: a new line, or more than fits beside the buttons", () => {
  expect(stacks("", 30)).toBe(false);
  expect(stacks("What is the latest potassium?", 30)).toBe(false);
  expect(stacks("Summarise the last 24 hours for bed 12", 30)).toBe(true);
  expect(stacks("a\nb", 30)).toBe(true);
  expect(stacks("Summarise the last 24 hours for bed 12", 80)).toBe(false); // the full-screen width
});

test("a scrolling text fades only at the ends with more beyond", () => {
  expect(fades(0, 100, 100)).toEqual({ top: false, bottom: false });
  expect(fades(0, 300, 160)).toEqual({ top: false, bottom: true });
  expect(fades(60, 300, 160)).toEqual({ top: true, bottom: true });
  expect(fades(140, 300, 160)).toEqual({ top: true, bottom: false });
});
