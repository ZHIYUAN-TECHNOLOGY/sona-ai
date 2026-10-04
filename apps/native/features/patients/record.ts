import type { DemoPatient } from "@sona-ai/domain/demo-patients";
import type { Patient } from "@/features/encounter/types";
import { serverDayPatients, type ServerAppointment } from "@/features/live/day";

/**
 * The judge build's rules for showing the hospital record as it was read: who is on the roster, which
 * admission a visit's guarantee letter belongs to, and what a count says before its read arrives. Pure;
 * the visit store, the sync and the count hooks call these, so nothing on screen comes from a fixture.
 */

/**
 * The visit store's roster from the server's patient list: everyone the server holds a visit for, in its
 * order. A person with no visit is left out, so nothing can open them as somebody else's visit (the
 * Patients list still shows them, and says so when tapped). A ward patient's record holds only the ward's
 * view of them, so what it lacks reads as empty or "Not documented", never as another patient's.
 * No clock time here: today's appointment time is laid over where the day is read (`dayVisits`).
 */
export function serverRoster(records: Record<string, DemoPatient> | undefined): Patient[] {
  return Object.values(records ?? {}).filter(r => r.encounterId).map(r => ({
    ...r, time: "", subtitle: r.subtitle ?? "", family: r.family ?? "Not documented", social: r.social ?? "Not documented",
    history: r.history ?? [], medicines: r.medicines ?? [], vitals: r.vitals ?? [], sources: r.sources ?? [],
  }));
}

/**
 * Today's visits, at the server's appointment times. Before day.list answers (or when it failed): sample
 * mode's roster as before, and in the judge build undefined, so a count shows no number rather than a guess.
 */
export const dayVisits = (judge: boolean, patients: Patient[], today: ServerAppointment[] | undefined): Patient[] | undefined =>
  today ? serverDayPatients(patients, today) : judge ? undefined : patients;

/**
 * Whether a visit's guarantee letter has arrived: its own patient's bed no longer lists that blocker.
 * No bed (never admitted, or gone home) waits on no letter.
 */
export const letterReceived = (beds: { patientId?: string; blockers: { kind: string }[] }[], patientId: string) =>
  !beds.some(b => b.patientId === patientId && b.blockers.some(x => x.kind === "gl"));

/** A key's line and badge from the count its page will show; while that read is on its way, `reading` and no number. */
export const counted = (n: number | undefined, line: (n: number) => string, reading: string): { status: string; badge?: number } =>
  n === undefined ? { status: reading } : { status: line(n), badge: n };
