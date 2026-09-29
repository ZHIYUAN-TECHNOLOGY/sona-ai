import type { AppRouterClient } from "@sona-ai/api/routers/index";
import type { PendingResult, ScheduleVisit } from "@/features/day/model";
import { EMPTY_CLAIM, type ClaimState, type Denial } from "@sona-ai/domain/claim";
import { EMPTY_DISCHARGE } from "@sona-ai/domain/discharge";
import type { Encounter, Patient, Task } from "@/features/encounter/types";

/**
 * Live mode's read side for tasks, lab results and My Day: pure mappings from the server's rows to
 * the shapes the fixture screens already render, so each screen swaps its source and nothing else.
 */
export type ServerTask = Awaited<ReturnType<AppRouterClient["tasks"]["list"]>>[number];
export type ServerResult = Awaited<ReturnType<AppRouterClient["results"]["list"]>>[number];
export type ServerAppointment = Awaited<ReturnType<AppRouterClient["day"]["list"]>>[number];

/** Clock time on this device, as the fixtures write it ("08:05"). */
const clock = (at: Date) => `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A visit's tasks, as the tasks screen lists them (the server has no source snapshot to show). */
export function serverTasks(rows: ServerTask[], encounterId: string): Task[] {
  return rows.filter(r => r.encounterId === encounterId).map(r => ({ id: r.id, title: r.title, owner: r.owner, due: r.due ?? "", completed: r.completed }));
}

/** The newest result nobody has acknowledged yet, shaped like the fixture's pending result. */
export function newestResult(rows: ServerResult[]): PendingResult | undefined {
  const r = rows.filter(row => !row.acknowledgedAt).sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())[0];
  return r && { id: r.id, patientId: r.patientId, test: r.test, value: r.unit ? `${r.value} ${r.unit}` : r.value, flag: r.flag ? sentence(r.flag) : "New", receivedAt: clock(new Date(r.receivedAt)) };
}

/** Today's demo patients with a server appointment, at the appointment's time, earliest first. */
export function serverDayPatients(patients: Patient[], rows: ServerAppointment[]): Patient[] {
  return rows.flatMap(r => {
    const patient = patients.find(p => p.id === r.patientId);
    return patient ? [{ ...patient, time: clock(new Date(r.startsAt)) }] : [];
  }).sort((a, b) => a.time.localeCompare(b.time));
}

/** Any day's appointment as a schedule row; it opens a visit only for a patient the app knows. */
export function serverVisit(r: ServerAppointment, known: string[]): ScheduleVisit {
  return { id: r.id, name: r.patientName, initials: r.initials, time: clock(new Date(r.startsAt)), reason: sentence(r.kind), incomplete: r.incomplete, patientId: known.includes(r.patientId) ? r.patientId : undefined };
}

/** What the server holds for a visit (the encounter row's state), as far as the app reads it. */
export type ServerVisitState = Partial<Pick<Encounter, "medicationEntries" | "prescriptionInputs" | "proposedMedicine" | "historyFacts">> & { discharge?: object; claim?: object };
type ClaimStatus = { status: string; approvedAt?: string | Date; reviewUrl?: string; query?: string; denial?: Denial; appealedAt?: string };
const STATUSES: ClaimState["status"][] = ["approved", "sent", "queried", "denied", "appealed"];

/**
 * In live mode the server's record of a visit wins over the fixture: its history, medicines and eligibility,
 * discharge fixes, claim fixes and status, and whether the guarantee letter has arrived. What it has
 * not recorded yet keeps the app's own value; the app's revision counter is left alone.
 */
export function mergeServerState<T extends Partial<Encounter>>(value: T, server: ServerVisitState, claim: ClaimStatus, glReceived: boolean): T {
  const status = STATUSES.find(s => s === claim.status) ?? "draft";
  return {
    ...value,
    ...(server.medicationEntries ? { medicationEntries: server.medicationEntries } : {}),
    ...(server.prescriptionInputs ? { prescriptionInputs: server.prescriptionInputs } : {}),
    ...(server.proposedMedicine !== undefined ? { proposedMedicine: server.proposedMedicine } : {}),
    ...(server.historyFacts ? { historyFacts: server.historyFacts } : {}),
    discharge: { ...EMPTY_DISCHARGE, ...value.discharge, ...server.discharge, glReceived },
    claim: { ...EMPTY_CLAIM, ...server.claim, status, approvedAt: claim.approvedAt === undefined ? undefined : String(claim.approvedAt), reviewUrl: claim.reviewUrl, query: claim.query, denial: claim.denial, appealedAt: claim.appealedAt },
  };
}
