import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import { FindingMarks, type Marked } from "@/features/imaging/marks";
import { usePan, ZOOM } from "@/features/imaging/pan";
import "@/styles/film.css";

/** The stage's zoom, as a slider beside it. */
export const ZoomSlider = ({ zoom, setZoom }: { zoom: number; setZoom: (zoom: number) => void }) => (
  <label className="xr-zoom">Zoom
    <input type="range" min={ZOOM.min} max={ZOOM.max} step={0.25} value={zoom} onChange={e => setZoom(Number(e.target.value))} />
  </label>
);

/**
 * The dark stage a film sits on, as /pro/xray and the film panel both show it: drag to move, double-click or pinch to
 * zoom (pan.ts), the findings boxed on it. Without `src` it holds `children` instead (the drop box, the camera); any
 * other `children` (a progress note) sit over the film.
 */
export function FilmStage({ src, alt, findings, zoom, setZoom, children, ...rest }: { src?: string; alt: string; findings: Marked[]; zoom: number; setZoom: (zoom: number) => void; children?: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  const pan = usePan(zoom, setZoom);
  return (
    <div className="xr-stage" {...rest} {...src && { ...pan.stage, "data-pan": pan.dragging ? "dragging" : "", title: "Drag to move · double-click or pinch to zoom" }}>
      {src && (
        <div className="xr-scroll" ref={pan.scroller}>
          <div className="xr-image" data-zoomed={zoom > 1 || undefined} style={{ "--xr-zoom": zoom } as CSSProperties}>
            <img src={src} alt={alt} draggable={false} />
            <FindingMarks findings={findings} />
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
