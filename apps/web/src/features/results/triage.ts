import type { Point } from "@/components/chart-scale";

/** The fields of a `results.list` row that triage reads. */
export type TriageRow = {
  id: string;
  patientId: string;
  test: string;
  value: string;
  unit: string | null;
  flag: string | null;
  critical: boolean;
  receivedAt: Date | string;
  acknowledgedAt: Date | string | null;
};

export type Filter = "all" | "abnormal" | "unacknowledged";

const time = (d: Date | string) => new Date(d).getTime();

/** 0 must not be missed, 1 flagged and waiting, 2 waiting, 3 acknowledged. */
export const priority = (r: TriageRow) => (r.acknowledgedAt ? 3 : r.critical ? 0 : r.flag ? 1 : 2);

/** By priority, then newest first. */
export const byTriage = (a: TriageRow, b: TriageRow) => priority(a) - priority(b) || time(b.receivedAt) - time(a.receivedAt);

export const matches = (filter: Filter) => (r: TriageRow) =>
  filter === "all" || (filter === "abnormal" ? Boolean(r.flag) : !r.acknowledgedAt);

/** The three insight counts. `now` decides which day "today" is (the browser's day). */
export function counts(rows: TriageRow[], now: Date) {
  const today = now.toDateString();
  return {
    mustNotMiss: rows.filter(r => priority(r) === 0).length,
    waiting: rows.filter(r => !r.acknowledgedAt && !r.critical).length,
    acknowledgedToday: rows.filter(r => r.acknowledgedAt && new Date(r.acknowledgedAt).toDateString() === today).length,
  };
}

/** The patient's earlier numeric values of the same test and unit, oldest first. Only rows that exist. */
export function seriesFor<T extends TriageRow>(rows: T[], selected: T): Point[] {
  const test = selected.test.trim().toLowerCase();
  return rows
    .filter(r => r.patientId === selected.patientId && r.test.trim().toLowerCase() === test && r.unit === selected.unit
      && r.value.trim() !== "" && Number.isFinite(Number(r.value)))
    .sort((a, b) => time(a.receivedAt) - time(b.receivedAt))
    .map(r => ({ x: new Date(r.receivedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }), y: Number(r.value) }));
}
