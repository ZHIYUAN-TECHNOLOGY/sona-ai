/** Pure scale and path maths for the SVG charts. No React here so it can be tested alone. */
export type Point = { x: string; y: number };

/** One decimal is plenty for a 600-wide viewBox and keeps the markup short. */
export const round = (n: number) => Math.round(n * 10) / 10;

/** [min, max] of the values; never zero-width, so one point or a flat series still has a scale. */
export function yDomain(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min > max) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  return [min, max];
}

/** Linear map from a domain to a pixel range. */
export function scale([d0, d1]: [number, number], [r0, r1]: [number, number]) {
  return (v: number) => round(r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));
}

/** X of each of n points spread edge to edge; a single point sits in the middle. */
export function pointXs(n: number, left: number, right: number): number[] {
  if (n === 1) return [round((left + right) / 2)];
  return Array.from({ length: n }, (_, i) => round(left + (i * (right - left)) / (n - 1)));
}

/** Centre x of each of n equal bands (bar charts). */
export function bandXs(n: number, left: number, right: number): number[] {
  const band = (right - left) / n;
  return Array.from({ length: n }, (_, i) => round(left + band * (i + 0.5)));
}

/** SVG path through the points: "M x y L x y ...". Empty string for no points. */
export function linePath(xs: number[], ys: number[]): string {
  return xs.map((x, i) => `${i === 0 ? "M" : "L"}${x} ${ys[i] ?? 0}`).join(" ");
}
