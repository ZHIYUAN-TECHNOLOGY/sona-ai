import { expect, test } from "bun:test";
import { flatSize, homography, project, rectQuad } from "./crop";

test("a dragged quad maps exactly onto the flat page", () => {
  const quad = [{ x: 120, y: 80 }, { x: 900, y: 140 }, { x: 860, y: 1300 }, { x: 60, y: 1180 }];
  const { width, height } = flatSize(quad);
  const m = homography(quad, rectQuad(0, 0, width, height));
  rectQuad(0, 0, width, height).forEach((corner, i) => {
    const p = project(m, quad[i]);
    expect(p.x).toBeCloseTo(corner.x, 6);
    expect(p.y).toBeCloseTo(corner.y, 6);
  });
});

test("an untouched frame is the identity, and large pages are capped", () => {
  const m = homography(rectQuad(0, 0, 400, 300), rectQuad(0, 0, 400, 300));
  [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(m[i]).toBeCloseTo(v, 9));
  expect(flatSize(rectQuad(0, 0, 4032, 3024))).toEqual({ width: 2400, height: 1800 });
});
