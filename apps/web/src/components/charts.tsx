import type { ReactNode } from "react";

import { bandXs, linePath, pointXs, scale, yDomain, type Point } from "./chart-scale";
import "../styles/components.css";

const W = 600;
const LEFT = 44;
const RIGHT = W - 16;
const TOP = 12;
const BOTTOM = 28;

type ChartProps = { points: Point[]; label: string; unit?: string; height?: number };

/** The shared shell: axis ends, x labels, and the values as a hidden table for screen readers. */
function ChartFrame({
  points, label, unit, height, domain, xs, children,
}: Required<Pick<ChartProps, "points" | "label" | "height">> & {
  unit?: string; domain: [number, number]; xs: number[]; children: ReactNode;
}) {
  if (points.length === 0) {
    return (
      <figure className="chart" aria-label={label}>
        <p className="chart-empty">No data yet</p>
      </figure>
    );
  }
  const floor = height - BOTTOM;
  const last = points.length - 1;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
        <line className="chart-grid" x1={LEFT} x2={RIGHT} y1={TOP} y2={TOP} />
        <line className="chart-grid" x1={LEFT} x2={RIGHT} y1={floor} y2={floor} />
        <text x={LEFT - 8} y={TOP + 4} textAnchor="end">{domain[1]}{unit ? ` ${unit}` : ""}</text>
        <text x={LEFT - 8} y={floor} textAnchor="end">{domain[0]}</text>
        {children}
        {points.map((p, i) =>
          // Every label up to 12 points; beyond that only the ends, so they never collide.
          points.length <= 12 || i === 0 || i === last ? (
            <text key={i} x={xs[i]} y={height - 8} textAnchor="middle">{p.x}</text>
          ) : null,
        )}
      </svg>
      <table className="visually-hidden">
        <caption>{label}</caption>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <th scope="row">{p.x}</th>
              <td>{p.y}{unit ? ` ${unit}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A trend over time. `band` shades the normal range; points outside it turn amber. */
export function LineChart({ points, label, unit, height = 200, band }: ChartProps & { band?: { low: number; high: number } }) {
  const values = points.map((p) => p.y);
  const domain = yDomain(band ? [...values, band.low, band.high] : values);
  const y = scale(domain, [height - BOTTOM, TOP]);
  const xs = pointXs(points.length, LEFT, RIGHT);
  const ys = values.map(y);
  return (
    <ChartFrame points={points} label={label} unit={unit} height={height} domain={domain} xs={xs}>
      {band ? <rect className="chart-band" x={LEFT} width={RIGHT - LEFT} y={y(band.high)} height={y(band.low) - y(band.high)} /> : null}
      <path className="chart-line" d={linePath(xs, ys)} />
      {points.map((p, i) => (
        <circle key={i} className="chart-dot" data-out={band && (p.y < band.low || p.y > band.high) ? "" : undefined} cx={xs[i]} cy={ys[i]} r={3.5} />
      ))}
    </ChartFrame>
  );
}

/** Amounts side by side. The scale always includes zero. */
export function BarChart({ points, label, unit, height = 200 }: ChartProps) {
  const domain = yDomain([0, ...points.map((p) => p.y)]);
  const y = scale(domain, [height - BOTTOM, TOP]);
  const xs = bandXs(points.length, LEFT, RIGHT);
  const width = Math.round(((RIGHT - LEFT) / Math.max(points.length, 1)) * 0.6);
  const zero = y(0);
  return (
    <ChartFrame points={points} label={label} unit={unit} height={height} domain={domain} xs={xs}>
      {points.map((p, i) => {
        const top = Math.min(y(p.y), zero);
        return <rect key={i} className="chart-bar" x={(xs[i] ?? 0) - width / 2} y={top} width={width} height={Math.abs(y(p.y) - zero)} rx={3} />;
      })}
    </ChartFrame>
  );
}
