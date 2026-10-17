import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";

export const ZOOM = { min: 1, max: 4 } as const;
const clamp = (z: number) => Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round(z * 4) / 4));

/**
 * A film you can take hold of, as in a PACS viewer: drag anywhere on the stage to move a zoomed film, double-click to
 * zoom in (or back out) at that point, pinch or ctrl-scroll to zoom where the pointer is. The film scrolls inside
 * `scroller`, so the slider, the marks drawn on it and the browser's own scrollbars all stay in step.
 * A press becomes a drag only after it moves a few pixels, so a click on a finding's mark still reaches the mark.
 */
export function usePan(zoom: number, setZoom: (zoom: number) => void) {
  const scroller = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean }>(null);
  // Where a zoom was asked for (the point under the pointer, as a fraction of the film), kept there once the film has grown.
  const anchor = useRef<{ fx: number; fy: number; px: number; py: number }>(null);
  const [dragging, setDragging] = useState(false);

  const zoomAt = (next: number, clientX: number, clientY: number) => {
    const el = scroller.current, to = clamp(next);
    if (!el || to === zoom) return;
    const box = el.getBoundingClientRect(), px = clientX - box.left, py = clientY - box.top;
    anchor.current = { fx: (el.scrollLeft + px) / el.scrollWidth, fy: (el.scrollTop + py) / el.scrollHeight, px, py };
    setZoom(to);
  };
  useLayoutEffect(() => {
    const el = scroller.current, a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = a.fx * el.scrollWidth - a.px;
    el.scrollTop = a.fy * el.scrollHeight - a.py;
  }, [zoom]);

  // Pinch on a trackpad arrives as ctrl + wheel; React's wheel listener is passive, so it cannot stop the page zooming.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(zoom * Math.exp(-e.deltaY / 200), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  const stage = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      const el = scroller.current;
      if (!el || e.button !== 0) return;
      press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const p = press.current, el = scroller.current;
      if (!p || !el || p.id !== e.pointerId) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (!p.moved && Math.hypot(dx, dy) < 4) return;
      if (!p.moved) { p.moved = true; e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); }
      el.scrollLeft = p.left - dx;
      el.scrollTop = p.top - dy;
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      if (press.current?.id !== e.pointerId) return;
      press.current = null;
      setDragging(false);
    },
    onPointerCancel: () => { press.current = null; setDragging(false); },
    onDoubleClick: (e: { clientX: number; clientY: number }) => zoomAt(zoom > ZOOM.min ? ZOOM.min : 2, e.clientX, e.clientY),
  };
  return { scroller, stage, dragging };
}
