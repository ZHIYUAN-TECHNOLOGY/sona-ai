/**
 * Straightening a photographed page: the doctor drags four corners onto the page's edges, and the
 * page is redrawn flat through a perspective (projective) transform, as a document scanner does.
 */
export type Point = { x: number; y: number };
/** Corners clockwise from the top left. */
export type Quad = [Point, Point, Point, Point];

export const rectQuad = (x: number, y: number, width: number, height: number): Quad =>
  [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];

/** The 3×3 projective transform (row-major, last entry 1) that takes each `from` corner onto the matching `to` corner. */
export function homography(from: Quad, to: Quad): number[] {
  // Two equations per corner: u = (ax + by + c) / (gx + hy + 1), v = (dx + ey + f) / (gx + hy + 1).
  const rows = from.flatMap(({ x, y }, i) => {
    const { x: u, y: v } = to[i]!;
    return [[x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]];
  });
  // Gauss–Jordan elimination with partial pivoting on the 8×9 augmented matrix.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(rows[r]![c]!) > Math.abs(rows[p]![c]!)) p = r;
    [rows[c], rows[p]] = [rows[p]!, rows[c]!];
    const pivot = rows[c]!;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const row = rows[r]!, f = row[c]! / pivot[c]!;
      for (let k = c; k < 9; k++) row[k] = row[k]! - f * pivot[k]!;
    }
  }
  return [...rows.map((row, i) => row[8]! / row[i]!), 1];
}

/** Where the transform `m` sends point `p`. */
export function project(m: number[], { x, y }: Point): Point {
  const w = m[6]! * x + m[7]! * y + m[8]!;
  return { x: (m[0]! * x + m[1]! * y + m[2]!) / w, y: (m[3]! * x + m[4]! * y + m[5]!) / w };
}

/** The flattened page's size: its longest opposite edges, capped so the file stays phone-sized. */
export function flatSize(q: Quad, max = 2400) {
  const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const w = Math.max(d(q[0], q[1]), d(q[3], q[2])), h = Math.max(d(q[0], q[3]), d(q[1], q[2]));
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}
