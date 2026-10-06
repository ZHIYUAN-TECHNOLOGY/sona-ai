import { priority, type TriageRow } from "./triage";

export type Tab = "action" | "new" | "acknowledged";

/** Needs action: critical or flagged, and waiting. New: anything waiting. Acknowledged: a doctor saw it. */
export const inTab = (tab: Tab) => (r: TriageRow) =>
  tab === "action" ? priority(r) <= 1 : tab === "new" ? priority(r) < 3 : priority(r) === 3;

/** The header's live counts, over waiting results only. */
export function summary(rows: TriageRow[]) {
  const fresh = rows.filter(inTab("new"));
  return {
    fresh: fresh.length,
    patients: new Set(fresh.map(r => r.patientId)).size,
    critical: fresh.filter(r => r.critical).length,
    review: fresh.filter(r => priority(r) === 1).length,
  };
}
