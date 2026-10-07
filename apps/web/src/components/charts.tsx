import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { useReveal } from "@/lib/motion";

import { bandXs, linePath, nearest, pointXs, scale, ticks, yDomain, type Point } from "./chart-scale";
import "../styles/components.css";
import "../styles/data.css";

const W = 600;
const LEFT = 44;
const RIGHT = W - 16;
const TOP = 24;
const BOTTOM = 28;

type ChartProps = {
  points: Point[];
  label: string;
  unit?: string;
  height?: number;
  /** A longer description for screen readers. */
  description?: string;
  /** A dashed target line. */
  goal?: { value: number; label?: string };
  /** Print each value above its mark. */
  showValues?: boolean;
  /** One line that interprets a point, shown in its tooltip. */
  describe?: (point: Point, index: number) => string;
};

type FrameProps = ChartProps & { height: number; domain: [number, number]; xs: number[]; ys: number[]; children: ReactNode };

/** The shared shell: gridlines, labels, goal line, tooltip, and the values as a hidden table. */
function ChartFrame({ points, label, unit, height, description, goal, showValues, describe, domain, xs, ys, children }: FrameProps) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  // Marks draw in when the data arrives: bars grow from the baseline, the line draws left to right, dots follow.
  const figure = useRef<HTMLElement>(null);
  useReveal(figure, ".chart-bar", { scaleY: 0, transformOrigin: "50% 100%" }, points.length);
  useReveal(figure, ".chart-line", { strokeDashoffset: 1, duration: 0.9 }, points.length);
  useReveal(figure, ".chart-dot, .chart-halo", { opacity: 0, delay: 0.3 }, points.length);
  if (points.length === 0) {
    return (
      <figure className="chart" aria-label={label}>
        <p className="chart-empty">No data yet</p>
      </figure>
    );
  }
  const y = scale(domain, [height - BOTTOM, TOP]);
  const last = points.length - 1;
  // "7%" and "7°C" read closed up; every other unit takes a space.
  const suffix = unit ? (/^[%°]/.test(unit) ? unit : ` ${unit}`) : "";
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setActive(nearest(xs, ((e.clientX - box.left) / box.width) * W));
  };
  const onKey = (e: KeyboardEvent) => {
    const at = active ?? last;
    if (e.key === "ArrowLeft") setActive(Math.max(at - 1, 0));
    else if (e.key === "ArrowRight") setActive(Math.min(at + 1, last));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };
  const shown = active === null ? undefined : points[active];
  const ax = active === null ? 0 : xs[active] ?? 0;
  const ay = active === null ? 0 : ys[active] ?? 0;
  return (
    <figure className="chart" ref={figure}>
      <svg
        viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} aria-describedby={`${id}-d`} tabIndex={0}
        onPointerMove={onMove} onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? last)} onBlur={() => setActive(null)} onKeyDown={onKey}
      >
        {ticks(domain).map((t, i) => (
          <g key={i}>
            <line className="chart-grid" x1={LEFT} x2={RIGHT} y1={y(t)} y2={y(t)} />
            <text x={LEFT - 8} y={y(t) + 4} textAnchor="end">{t}</text>
          </g>
        ))}
        {goal ? (
          <g>
            <line className="chart-goal" x1={LEFT} x2={RIGHT} y1={y(goal.value)} y2={y(goal.value)} />
            <text className="chart-goal-label" x={LEFT + 6} y={y(goal.value) - 6}>{goal.label ?? `Goal ${goal.value}${suffix}`}</text>
          </g>
        ) : null}
        {children}
        {showValues ? points.map((p, i) => <text key={i} className="chart-value" x={xs[i]} y={(ys[i] ?? 0) - 10} textAnchor="middle">{p.y}</text>) : null}
        {shown ? <circle className="chart-active" cx={ax} cy={ay} r={7} /> : null}
        {points.map((p, i) =>
          // Every label up to 12 points; beyond that only the ends, so they never collide.
          points.length <= 12 || i === 0 || i === last ? (
            <text key={i} x={xs[i]} y={height - 8} textAnchor="middle">{p.x}</text>
          ) : null,
        )}
      </svg>
      {shown ? (
        <div className="chart-tip" data-side={ax > W * 0.75 ? "end" : ax < W * 0.25 ? "start" : undefined} style={{ left: `${(ax / W) * 100}%`, top: `${(ay / height) * 100}%` }} aria-hidden="true">
          <span className="chart-tip-over">{shown.x}</span>
          <strong>{shown.y}{suffix}</strong>
          {describe && active !== null ? <span>{describe(shown, active)}</span> : null}
        </div>
      ) : null}
      <p id={`${id}-d`} className="visually-hidden">{description ?? `${points.length} values${unit ? ` in ${unit}` : ""}. Use the arrow keys to read each one.`}</p>
      <p className="visually-hidden" aria-live="polite">{shown && active !== null ? `${shown.x}: ${shown.y}${suffix}${describe ? `. ${describe(shown, active)}` : ""}` : ""}</p>
      <table className="visually-hidden">
        <caption>{label}</caption>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <th scope="row">{p.x}</th>
              <td>{p.y}{suffix}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A trend over time. `band` shades the normal range; points outside it turn amber. */
export function LineChart({ height = 200, band, ...props }: ChartProps & { band?: { low: number; high: number } }) {
  const { points, goal } = props;
  const values = points.map((p) => p.y);
  const domain = yDomain([...values, ...(band ? [band.low, band.high] : []), ...(goal ? [goal.value] : [])]);
  const y = scale(domain, [height - BOTTOM, TOP]);
  const xs = pointXs(points.length, LEFT, RIGHT);
  const ys = values.map(y);
  const last = points.length - 1;
  return (
    <ChartFrame {...props} height={height} domain={domain} xs={xs} ys={ys}>
      {band ? <rect className="chart-band" x={LEFT} width={RIGHT - LEFT} y={y(band.high)} height={y(band.low) - y(band.high)} /> : null}
      <path className="chart-line" d={linePath(xs, ys)} pathLength={1} />
      {last >= 0 ? <circle className="chart-halo" cx={xs[last]} cy={ys[last]} r={10} /> : null}
      {points.map((p, i) => (
        <circle key={i} className="chart-dot" data-last={i === last ? "" : undefined} data-out={band && (p.y < band.low || p.y > band.high) ? "" : undefined} cx={xs[i]} cy={ys[i]} r={4} />
      ))}
    </ChartFrame>
  );
}

/** Amounts side by side. The scale always includes zero. */
export function BarChart({ height = 200, ...props }: ChartProps) {
  const { points, goal } = props;
  const domain = yDomain([0, ...points.map((p) => p.y), ...(goal ? [goal.value] : [])]);
  const y = scale(domain, [height - BOTTOM, TOP]);
  const xs = bandXs(points.length, LEFT, RIGHT);
  const width = Math.round(((RIGHT - LEFT) / Math.max(points.length, 1)) * 0.6);
  const zero = y(0);
  return (
    <ChartFrame {...props} height={height} domain={domain} xs={xs} ys={points.map((p) => Math.min(y(p.y), zero))}>
      {points.map((p, i) => (
        <rect key={i} className="chart-bar" data-last={i === points.length - 1 ? "" : undefined} x={(xs[i] ?? 0) - width / 2} y={Math.min(y(p.y), zero)} width={width} height={Math.abs(y(p.y) - zero)} rx={4} />
      ))}
    </ChartFrame>
  );
}

/** A tiny trend with no axes, for a table cell or stat. Amber flags one to watch. */
export function Sparkline({ values, label, tone = "neutral", width = 96, height = 28 }: { values: number[]; label: string; tone?: "amber" | "neutral"; width?: number; height?: number }) {
  if (values.length === 0) return null;
  const xs = pointXs(values.length, 4, width - 4);
  const ys = values.map(scale(yDomain(values), [height - 4, 4]));
  return (
    <svg className="sparkline" data-tone={tone} viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
      <path d={linePath(xs, ys)} />
      <circle cx={xs.at(-1)} cy={ys.at(-1)} r={3} />
    </svg>
  );
}

/** A state's chart fill: the status colours' chart shades (tokens.css), or the neutral rest. */
export type ChartTone = "red" | "amber" | "green" | "blue" | "neutral";
export type Segment = { label: string; value: number; tone: ChartTone };

/**
 * How a whole splits into states: one bar cut in proportion, with every state named and counted under it, so no
 * state is told by colour alone. Empty states leave the bar but stay in the list. `label` names the figure.
 */
export function SegmentBar({ label, segments }: { label: string; segments: Segment[] }) {
  const figure = useRef<HTMLElement>(null);
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  useReveal(figure, ".seg", { scaleX: 0, transformOrigin: "0% 50%" }, total);
  return (
    <figure className="chart seg-chart" ref={figure} aria-label={label}>
      <div className="seg-bar" aria-hidden="true">
        {segments.map(s => (s.value > 0 ? <span key={s.label} className="seg" data-chart-tone={s.tone} style={{ flexGrow: s.value }} title={`${s.label}: ${s.value} of ${total}`} /> : null))}
      </div>
      <dl className="seg-legend">
        {segments.map(s => (
          <div key={s.label} data-empty={s.value === 0 ? "" : undefined}>
            <dt><span className="seg-key" data-chart-tone={s.tone} />{s.label}</dt>
            <dd className="num">{s.value}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

/** Ranked amounts with long names: one row each, the name, a bar to the largest, the number. Pass rows largest first. */
export function BarList({ label, rows, tone = "blue", unit }: { label: string; rows: { label: string; value: number }[]; tone?: ChartTone; unit?: string }) {
  const figure = useRef<HTMLElement>(null);
  useReveal(figure, ".bar-fill", { scaleX: 0, transformOrigin: "0% 50%" }, rows.length);
  const max = Math.max(...rows.map(r => r.value), 1);
  if (rows.length === 0) return <figure className="chart" aria-label={label}><p className="chart-empty">No data yet</p></figure>;
  return (
    <figure className="chart" ref={figure} aria-label={label}>
      <ol className="bar-list">
        {rows.map(r => (
          <li key={r.label}>
            <span className="bar-name" title={r.label}>{r.label}</span>
            <span className="bar-track" aria-hidden="true"><span className="bar-fill" data-chart-tone={tone} style={{ width: `${(r.value / max) * 100}%` }} /></span>
            <span className="bar-value num">{r.value}{unit ? ` ${r.value === 1 ? unit.replace(/s$/, "") : unit}` : ""}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
