// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { describe, expect, test } from "bun:test";

import { BLOOM_MS, LOOK, moving, orbState, step } from "./sona-orb";

describe("orbState", () => {
  const base = { closed: true, pending: false, blooming: false, hover: false };
  test("rests with nothing going on", () => expect(orbState(base)).toBe("rest"));
  test("hover or focus wakes it", () => expect(orbState({ ...base, hover: true })).toBe("hover"));
  test("a pending answer while closed thinks, even under the pointer", () => expect(orbState({ ...base, pending: true, hover: true })).toBe("thinking"));
  test("a pending answer with the panel open is not the orb's to show", () => expect(orbState({ ...base, closed: false, pending: true })).toBe("rest"));
  test("a fresh answer blooms over everything", () => expect(orbState({ ...base, pending: true, hover: true, blooming: true })).toBe("answered"));
  test("the bloom lasts about 1.2 s", () => expect(BLOOM_MS).toBe(1200));
});

describe("step and moving", () => {
  test("rest is still: no frame is needed once the look has landed", () => expect(moving(LOOK.rest, LOOK.rest)).toBe(false));
  test("every other state keeps drawing", () => {
    for (const state of ["hover", "thinking", "answered"] as const) expect(moving(LOOK[state], LOOK[state])).toBe(true);
  });
  test("leaving hover eases to rest within a second at 60 fps, then stops", () => {
    let look = LOOK.hover, frames = 0;
    while (moving(look, LOOK.rest) && frames < 600) { look = step(look, LOOK.rest, 1 / 60); frames++; }
    expect(look).toEqual(LOOK.rest);
    expect(frames).toBeLessThan(90);
    expect(frames).toBeGreaterThan(30); // eases, does not snap
  });
  test("a long frame (a hidden tab) still lands without overshoot", () => {
    const look = step(LOOK.rest, LOOK.answered, 10);
    expect(look).toEqual(LOOK.answered);
  });
});
