import { describe, expect, it, test } from "bun:test";
import { MAX_ZOOM, clamp, fitted, limit, markerAt, markerUnder, rubberBand, zoomAround } from "./zoom";

describe("image viewer geometry", () => {
  it("fits a portrait radiograph by width in a taller viewport, and by height in a wider one", () => {
    expect(fitted(400, 500, 0.8)).toEqual([400, 500]);
    expect(fitted(400, 600, 0.8)).toEqual([400, 500]);
    expect(fitted(400, 400, 0.8)).toEqual([320, 400]);
    expect(fitted(300, 600, 0)).toEqual([300, 600]);
  });

  it("allows no travel until the scaled image outgrows the viewport", () => {
    expect(limit(320, 400, 1)).toBe(0);
    expect(limit(320, 400, 1.2)).toBe(0);
    expect(limit(320, 400, 2)).toBe(120);
  });

  it("keeps the pinched point under the fingers", () => {
    const focal = 60, from = 1.5, to = 3, translate = -20;
    const point = (focal - translate) / from; // image-space point under the focal
    expect(point * to + zoomAround(focal, translate, from, to)).toBeCloseTo(focal);
  });

  it("rubber-bands past a limit without passing it back or jumping", () => {
    expect(rubberBand(50, -100, 100, 400)).toBe(50);
    const over = rubberBand(160, -100, 100, 400);
    expect(over).toBeGreaterThan(100);
    expect(over).toBeLessThan(160);
    expect(rubberBand(100.001, -100, 100, 400)).toBeCloseTo(100);
    expect(rubberBand(-1e6, -100, 100, 400)).toBeGreaterThan(-500);
    expect(rubberBand(0.5, 1, MAX_ZOOM, 1)).toBeGreaterThan(0.5);
    expect(clamp(rubberBand(8, 1, MAX_ZOOM, 1), 1, MAX_ZOOM)).toBe(MAX_ZOOM);
  });

  it("places a finding marker on the fitted image, not the letterbox around it", () => {
    // A 300 × 300 image centred in a 400 × 300 viewport starts 50 pt in.
    expect(markerAt(400, 300, 1, 0, 0)).toEqual([50, 0]);
    expect(markerAt(400, 300, 1, 0.5, 0.5)).toEqual([200, 150]);
    expect(markerAt(400, 300, 1, 1, 1)).toEqual([350, 300]);
  });
});

test("a tap on a zoomed, panned image lands back on the marker it covers, and misses by more than a fingertip land nowhere", () => {
  // 300 x 400 viewport, square image (letterboxed to 300 x 300), zoomed 2x and panned 50 pt left.
  const markers = [{ id: "nodule", x: 0.34, y: 0.3 }, { id: "heart", x: 0.56, y: 0.62 }];
  const [px, py] = markerAt(300, 400, 1, 0.34, 0.3); // 102, 140 unzoomed
  const tapX = (px - 150) * 2 + 150 - 50, tapY = (py - 200) * 2 + 200;
  expect(markerUnder(markers, tapX, tapY, { w: 300, h: 400, aspect: 1, scale: 2, x: -50, y: 0 }, 28)).toBe("nodule");
  expect(markerUnder(markers, 10, 10, { w: 300, h: 400, aspect: 1, scale: 2, x: -50, y: 0 }, 28)).toBeUndefined();
});
