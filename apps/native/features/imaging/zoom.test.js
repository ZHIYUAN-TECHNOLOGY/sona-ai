import { describe, expect, it } from "bun:test";
import { MAX_ZOOM, clamp, fitted, limit, rubberBand, zoomAround } from "./zoom";

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
});
