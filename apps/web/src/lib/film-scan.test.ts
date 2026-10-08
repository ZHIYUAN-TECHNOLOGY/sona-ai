// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { beamAt, elapsed } from "./film-scan";

test("the beam starts above the film, heading down, its wake behind it", () => {
  const { beam, wake } = beamAt(0);
  expect(beam).toBeLessThan(0);
  expect(wake).toBeGreaterThan(0);
});
test("halfway down it moves fastest, so the wake is longest", () => expect(beamAt(0.25).wake).toBeCloseTo(0.25));
test("it turns past the bottom edge", () => expect(beamAt(0.5).beam).toBeGreaterThan(1));
test("on the way back up the wake trails below", () => expect(beamAt(0.75).wake).toBeLessThan(0));
test("a round trip ends where it started", () => expect(beamAt(1).beam).toBeCloseTo(beamAt(0).beam));
test("the clock reads in tenths of a second", () => { expect(elapsed(4210)).toBe("4.2 s"); expect(elapsed(-5)).toBe("0.0 s"); });
