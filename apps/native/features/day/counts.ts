import { defaultMedications } from "@/features/encounter/clinical-state";
import type { Encounter, HistoryFact, Patient, Task } from "@/features/encounter/types";
import { newestResult, resultRow, serverTasks, type ServerResult, type ServerTask } from "@/features/live/day";
import { taskCounts } from "@/features/tasks/counts";
import { localDate } from "@/features/tasks/state";
import type { Bed } from "@/features/ward/model";
import { PENDING_RESULT, testInSentence, type PendingResult } from "./model";

/**
 * One source for every count the app shows twice: the result waiting on a doctor, who needs you,
 * open follow-ups and the ward's blockers. Today, Patients, the patient sheet, the sidebar, home's
 * keys, Sona's day answers and the top bar all read these, so no two places can disagree. Pure; the
 * hooks that feed them live in `use-counts.ts`.
 */
type Server = { tasks: ServerTask[]; results: ServerResult[] } | undefined;

/** Who acknowledged a result, and when (ISO). Demo mode keeps these in the encounter store; live mode reads the server's row. */
export type Ack = { at: string; by: string };
export const resultKey = (r: Pick<PendingResult, "id" | "patientId" | "test">) => r.id ?? `${r.patientId}:${r.test}`;

/** The result waiting on a doctor: live, the server's newest unacknowledged one; demo, the fixture until it is acknowledged here. */
export function pendingResult(server: Server, acks: Record<string, Ack>): PendingResult | undefined {
  if (server) return newestResult(server.results);
  return acks[resultKey(PENDING_RESULT)] ? undefined : PENDING_RESULT;
}

/**
 * A patient's newest result for the briefing, with its acknowledgement once there is one. An acknowledged
 * live result shows for a day after it was acknowledged (its receipt); older ones are history, not news.
 * `now` is the hospital's demo clock in live mode, the clock the server stamps acknowledgements on.
 */
export function patientResult(patientId: string, server: Server, acks: Record<string, Ack>, now: Date): { result: PendingResult; ack?: Ack } | undefined {
  if (!server) {
    if (PENDING_RESULT.patientId !== patientId) return undefined;
    return { result: PENDING_RESULT, ack: acks[resultKey(PENDING_RESULT)] };
  }
  // The newest result still waiting wins; when none waits, the one acknowledged last shows as its receipt (if that was today).
  const mine = server.results.filter(r => r.patientId === patientId).sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  const row = mine.find(r => !r.acknowledgedAt) ?? [...mine].sort((a, b) => new Date(b.acknowledgedAt!).getTime() - new Date(a.acknowledgedAt!).getTime())[0];
  if (!row) return undefined;
  const ack = row.acknowledgedAt ? { at: new Date(row.acknowledgedAt).toISOString(), by: row.acknowledgedByName ?? "a colleague" } : undefined;
  // Older than a day is history, not news; the demo clock can stamp acknowledgements ahead of this device, so later always counts.
  if (ack && now.getTime() - new Date(ack.at).getTime() > 24 * 3600_000) return undefined;
  return { result: resultRow(row, server.results), ack };
}

const clock = (at: Date) => `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
/** "Acknowledged 10:14 by Dr Lim" (with the date when it wasn't today on `now`, the demo clock in live mode). */
export function receiptLine(ack: Ack, now: Date) {
  const at = new Date(ack.at);
  const when = at.toDateString() === now.toDateString() ? clock(at) : `${at.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${clock(at)}`;
  return `Acknowledged ${when} by ${ack.by}`;
}

/** "Potassium 3.1 mmol/L · low · last 3.8 on 14 Sep" */
export const resultLine = (r: PendingResult) => [`${r.test} ${r.value}`, r.flag.toLowerCase(), r.last ? `last ${r.last}` : ""].filter(Boolean).join(" · ");

/** Where a flag leads: a question in the visit, a page in it, or another page. */
export type Go = { next?: string; view?: string; to?: "/handover" | `/inbox/${string}` };
export type Flag = { label: string; tone: "urgent" | "caution"; go: Go };

/** The allergy a clinician recorded in this visit (the allergy row's Confirm, or a history correction); until one is, the record's allergy needs confirming. */
export const confirmedAllergy = (encounter: Pick<Encounter, "historyFacts"> | undefined) => encounter?.historyFacts?.findLast(fact => fact.category === "allergy");

/**
 * What the allergy row's Confirm records: the same history edit a correction makes, so live mode saves it to the
 * server. The record's note that it needs confirming goes; `date` keeps the time for the receipt.
 */
export function allergyConfirmation(patient: Patient, revision: number, by: string, at = new Date()): HistoryFact {
  return { id: `history-${patient.id}-${at.getTime()}`, category: "allergy", value: (patient.allergies ?? "").replace(/;\s*details need confirmation$/i, ""), source: `Confirmed by ${by}`, date: `${localDate(at)} ${clock(at)}`, revision };
}

/** "Allergy confirmed · 14:32", with the day when it wasn't today (a history correction has a day, no time). */
export function allergyLine(fact: Pick<HistoryFact, "date">, now = new Date()) {
  const [day = "", time] = fact.date.split(" ");
  const date = day === localDate(now) ? "" : new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `Allergy confirmed · ${[date, time].filter(Boolean).join(" ") || "today"}`;
}

/**
 * Why a patient needs you, most urgent first: the result waiting on a doctor, the allergy, medicines to confirm, missing
 * history. With the visit: an allergy a clinician recorded asks nothing more, and once discharged only the result does.
 */
export function patientFlags(patient: Patient, unconfirmed: number, result: PendingResult | undefined, encounter: Encounter | undefined): Flag[] {
  const flags: Flag[] = [];
  if (result?.patientId === patient.id) flags.push({ label: `${result.flag} ${testInSentence(result.test)} ${result.value}`, tone: "urgent", go: { next: "briefing" } });
  if (encounter?.discharge?.dischargedAt) return flags;
  const allergy = confirmedAllergy(encounter);
  if (patient.allergies && !allergy) flags.push({ label: `${patient.allergies.split(" — ")[0]} allergy · confirm`, tone: "caution", go: { next: "medication" } });
  if (!patient.incomplete && unconfirmed) flags.push({ label: `${unconfirmed} ${unconfirmed === 1 ? "medicine" : "medicines"} unconfirmed`, tone: "caution", go: { next: "medication" } });
  if (patient.incomplete) flags.push({ label: "History incomplete", tone: "caution", go: { next: "reasoning" } });
  if (patient.incomplete && !allergy) flags.push({ label: "Allergies unknown", tone: "caution", go: { view: "recording" } });
  return flags;
}

export const unconfirmedOf = (patient: Patient, encounter: Encounter | undefined) => (encounter?.medicationEntries ?? defaultMedications(patient)).filter(m => !m.confirmed).length;

/** The patients who need you (not the items): each with the most urgent reason, red ones first. */
export function needsYou(patients: Patient[], encounters: Record<string, Encounter | undefined>, result: PendingResult | undefined) {
  return patients.flatMap(patient => {
    const [flag] = patientFlags(patient, unconfirmedOf(patient, encounters[patient.id]), result, encounters[patient.id]);
    return flag ? [{ patient, flag }] : [];
  }).sort((a, b) => Number(b.flag.tone === "urgent") - Number(a.flag.tone === "urgent"));
}

/** "2 patients need you": the count is always of patients. */
export const needLine = (n: number) => n === 0 ? "Nobody needs you now" : `${n} ${n === 1 ? "patient needs" : "patients need"} you`;

/** A visit's follow-ups: the ones made on this device, plus the server's for its encounter in live mode. */
export const visitTasks = (patient: Patient, encounters: Record<string, Encounter | undefined>, server: Server): Task[] =>
  [...encounters[patient.id]?.tasks ?? [], ...server ? serverTasks(server.tasks, patient.encounterId) : []];

/** Open follow-ups across these visits, from the same list the Tasks page shows. */
export const openTaskCount = (patients: Patient[], encounters: Record<string, Encounter | undefined>, server: Server) =>
  taskCounts(patients.flatMap(p => visitTasks(p, encounters, server))).open;

/**
 * Demo mode's ward with the X-ray's open findings on their patient's bed, the way the server derives
 * them (`bedBlockers`), so Bed 6 counts the same blockers on the Ward as on its Discharge page.
 */
export function withFindingBlockers(beds: Bed[], findings: { id: string; patientId: string; label: string; status: string }[]): Bed[] {
  return beds.map(bed => {
    const open = findings.filter(f => f.status === "open" && f.patientId === bed.patientId);
    return open.length ? { ...bed, predicted: "Once cleared", blockers: [...bed.blockers, ...open.map(f => ({ id: `${bed.bed}-finding-${f.id}`, kind: "result" as const, label: f.label, detail: "Unvalidated finding · follow-up not tracked" }))] } : bed;
  });
}
