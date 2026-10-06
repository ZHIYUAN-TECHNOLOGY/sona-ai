import type { Point } from "@/components/chart-scale";
import { isFlagged } from "@/features/results/triage";

type At = Date | string;
type TrendPoint = { at: At; value: number; flag?: string | null };

/** The shape `patients.trends` answers with, as far as this page reads it. */
export type Trends = {
  observations: { kind: string; unit?: string | null; points: TrendPoint[] }[];
  labs: { test: string; unit?: string | null; points: TrendPoint[] }[];
};

export type Series = { name: string; lab: boolean; unit?: string | null; points: TrendPoint[] };

const time = (d: At) => new Date(d).getTime();
const oldestFirst = (points: TrendPoint[]) => [...points].sort((a, b) => time(a.at) - time(b.at));

/** Labs and observations as one list, each oldest first, empty series dropped. */
export function allSeries(t: Trends): Series[] {
  return [
    ...t.labs.map(l => ({ name: l.test, lab: true, unit: l.unit, points: oldestFirst(l.points) })),
    ...t.observations.map(o => ({ name: o.kind, lab: false, unit: o.unit, points: oldestFirst(o.points) })),
  ].filter(s => s.points.length > 0);
}

export const latestOf = (s: Series) => s.points[s.points.length - 1]!;
/** 0 a lab whose latest value is flagged, 1 an observation, 2 any other lab. */
const rank = (s: Series) => (s.lab ? (isFlagged(latestOf(s).flag) ? 0 : 2) : 1);

/** The series that matter most: flagged latest labs, then observations, then other labs; newest first within each. */
export const topSeries = (all: Series[], n = 3) =>
  [...all].sort((a, b) => rank(a) - rank(b) || time(latestOf(b).at) - time(latestOf(a).at)).slice(0, n);

/** The latest value against the one before it, in words. */
export function direction(s: Series) {
  const prev = s.points[s.points.length - 2];
  if (!prev) return "Only value on record";
  const now = latestOf(s).value;
  return `${now > prev.value ? "Up" : now < prev.value ? "Down" : "Unchanged"} from ${prev.value}`;
}

export const chartPoints = (s: Series): Point[] =>
  s.points.map(p => ({ x: new Date(p.at).toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short" }), y: p.value }));
