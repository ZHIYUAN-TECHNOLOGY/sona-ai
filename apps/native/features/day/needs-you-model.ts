import type { Patient, Task } from "@/features/encounter/types";
import { rankByDue } from "@/features/tasks/counts";
import { friendlyDate, localDate } from "@/features/tasks/state";
import { SUGGESTED, bedKind, type Bed, type Owner } from "@/features/ward/model";
import type { Flag, Go } from "./counts";
import { resultAge, type PendingResult } from "./model";

/**
 * Today's three sections under the home keys, from data the app already holds: who needs you (the header's own
 * count, `needsYou`, in its order), the blocked discharges (the ward's beds and their owners) and your tasks (the
 * Tasks page's list, with the handover). Each row is who, one reason with its number or time, and one action.
 * Pure; `needs-you.tsx` feeds and draws it.
 */
export const MAX_ROWS = 3;
export type RowTone = "urgent" | "soon" | "calm";
/** One section: its first rows and how many there are in all (the title's count; "See all" past MAX_ROWS). */
export type Section<T> = { rows: T[]; total: number };
const section = <T>(all: T[]): Section<T> => ({ rows: all.slice(0, MAX_ROWS), total: all.length });

/** A flag's action, named for where it goes in the visit. */
const VERB: Record<string, string> = { briefing: "Review", medication: "Confirm", reasoning: "Take history", recording: "Record" };
export type NeedRow = { id: string; patientId: string; who: string; reason: string; tone: RowTone; action: string; go: Go };
/** The patients who need you, exactly as the header counts them; the waiting result says how long it has waited. */
export function needRows(needs: { patient: Patient; flag: Flag }[], result: PendingResult | undefined, now: number): Section<NeedRow> {
  return section(needs.map(({ patient, flag }) => ({
    id: patient.id, patientId: patient.id, who: patient.name, go: flag.go, tone: flag.tone === "urgent" ? "urgent" : "soon",
    reason: flag.go.next === "briefing" && result?.patientId === patient.id ? `${flag.label} · ${resultAge(result, now)}, no action` : flag.label,
    action: VERB[flag.go.next ?? flag.go.view ?? ""] ?? "Open",
  })));
}

/**
 * A blocked bed's row: the first blocker nobody owns (else the first), who is on it, and the one move. A guarantee letter
 * for a patient with a visit here opens the letter; an unowned blocker goes to its suggested team (the Ward's assign);
 * an owned one opens the bed. Beds with an unowned blocker lead, then the most bed-hours waiting.
 */
export type BlockedRow = { id: string; bed: string; who: string; reason: string; blockerId: string; label: string; owner?: Owner; suggested: Owner; action: "letter" | "assign" | "bed"; patientId?: string; hours: number };
export function blockedRows(beds: Bed[], owners: Record<string, string | undefined>, hasVisit: (patientId: string) => boolean): Section<BlockedRow> {
  const rows = beds.filter(b => bedKind(b) === "blocked").map(b => {
    const unowned = b.blockers.filter(x => !owners[x.id]);
    const x = unowned[0] ?? b.blockers[0]!;
    const owner = owners[x.id] as Owner | undefined, more = b.blockers.length - 1;
    const hours = b.waitingHours ?? 0;
    return {
      id: b.bed, bed: b.bed, who: `${b.bed} · ${(b.name ?? "Patient").split(" ")[0]}`, blockerId: x.id, label: x.label, owner, suggested: SUGGESTED[x.kind], patientId: b.patientId, hours,
      reason: [`${x.label}${more ? ` +${more}` : ""}`, owner ? `${owner} on it` : "no owner", hours ? `${hours} h waiting` : ""].filter(Boolean).join(" · "),
      action: x.kind === "gl" && b.patientId && hasVisit(b.patientId) ? "letter" as const : owner ? "bed" as const : "assign" as const,
      unowned: unowned.length > 0,
    };
  }).sort((a, b) => Number(b.unowned) - Number(a.unowned) || b.hours - a.hours);
  return section(rows.map(({ unowned: _, ...row }) => row));
}

/** The handover leads (it ends the shift), then open tasks soonest due first, as the Tasks page ranks them. */
export type TaskRow = { id: string; title: string; reason: string; tone: RowTone; kind: "handover" } | { id: string; title: string; reason: string; tone: RowTone; kind: "task"; task: Task; patientId: string };
export function taskRows(tasks: { task: Task; patient: Patient }[], handover: number | undefined, today: Date): Section<TaskRow> {
  const day = localDate(today);
  const open = rankByDue(tasks, today).flatMap(g => g.rows).map(({ task, patient }): TaskRow => {
    const overdue = /^\d{4}-\d{2}-\d{2}$/.test(task.due) && task.due < day;
    return { id: task.id, kind: "task", task, patientId: patient.id, title: task.title, tone: overdue ? "soon" : "calm",
      reason: `${patient.name.split(" ")[0]} · ${task.due ? `${overdue ? "Overdue · " : "Due "}${friendlyDate(task.due, today)}` : "No due date"}` };
  });
  return section([...handover ? [{ id: "handover", kind: "handover" as const, title: `Hand over ${handover} ${handover === 1 ? "patient" : "patients"}`, reason: "Before you leave", tone: "calm" as const }] : [], ...open]);
}
