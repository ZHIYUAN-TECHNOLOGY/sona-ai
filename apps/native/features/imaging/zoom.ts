/** Viewer geometry, shared by the gesture worklets and the zoom buttons. Origin is the viewport centre. */
export const MAX_ZOOM = 5;
export const DOUBLE_TAP_ZOOM = 2.5;
export const ZOOM_STEP = 0.5;

export function clamp(value: number, min: number, max: number) {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

/** Size of a `contain`-fitted image at scale 1. `aspect` is width / height (0 until the image loads). */
export function fitted(viewportW: number, viewportH: number, aspect: number): [number, number] {
  "worklet";
  const a = aspect > 0 ? aspect : viewportW / viewportH;
  return a > viewportW / viewportH ? [viewportW, viewportW / a] : [viewportH * a, viewportH];
}

/** A normalised image point (0 to 1 from the top left) in viewport points at scale 1, allowing for the letterbox. */
export function markerAt(viewportW: number, viewportH: number, aspect: number, x: number, y: number): [number, number] {
  "worklet";
  const [w, h] = fitted(viewportW, viewportH, aspect);
  return [(viewportW - w) / 2 + x * w, (viewportH - h) / 2 + y * h];
}

/** How far the scaled image may move from centre before its edge leaves the viewport edge. */
export function limit(content: number, viewport: number, scale: number) {
  "worklet";
  return Math.max(0, (content * scale - viewport) / 2);
}

/** Past a limit, movement meets growing resistance (UIScrollView's rubber band, c = 0.55). */
export function rubberBand(value: number, min: number, max: number, dimension: number) {
  "worklet";
  const band = (over: number) => (1 - 1 / ((over * 0.55) / dimension + 1)) * dimension;
  if (value < min) return min - band(min - value);
  if (value > max) return max + band(value - max);
  return value;
}

/** Translation that keeps the image point under `focal` fixed while the scale goes `from` → `to`. */
export function zoomAround(focal: number, translate: number, from: number, to: number) {
  "worklet";
  return focal - ((focal - translate) * to) / from;
}

/**
 * The marker under a tap on the zoomed and panned viewport, within `reach` points on screen: the
 * tap is taken back to the unzoomed image the markers are placed on.
 */
export function markerUnder(markers: { id: string; x: number; y: number }[], tapX: number, tapY: number, view: { w: number; h: number; aspect: number; scale: number; x: number; y: number }, reach: number) {
  "worklet";
  const { w, h, aspect, scale, x, y } = view;
  const ix = (tapX - w / 2 - x) / scale + w / 2, iy = (tapY - h / 2 - y) / scale + h / 2;
  let hit: string | undefined, best = reach / scale;
  for (const m of markers) {
    const [px, py] = markerAt(w, h, aspect, m.x, m.y);
    const d = Math.hypot(px - ix, py - iy);
    if (d < best) { best = d; hit = m.id; }
  }
  return hit;
}
