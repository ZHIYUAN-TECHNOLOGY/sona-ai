import { router } from "expo-router";
import type { QuickAction } from "@/components/sona/quick-actions";
import { PENDING_RESULT, testInSentence } from "@/features/day/model";
import { newestResult, serverDayPatients } from "@/features/live/day";
import { useRole } from "@/features/live/roles";
import { useOpenAudit } from "@/features/audit";
import { shortRM, totalRisk, type AuditItem } from "@/features/audit/model";
import { useInboxSummary } from "@/features/inbox";
import { useTrainingStatus } from "@/features/training";
import { trainingLine } from "@/features/training/model";
import { acknowledgeResult, useAckFailed, useServerData, useServerDay, type ServerData } from "@/features/live/server-day";
import { localDate } from "@/features/tasks/state";
import { useServerEncounter } from "@/features/live/sync";
import { DEMO_PATIENT, wardBeds, wardSummary } from "@/features/ward/model";
import { defaultMedications } from "./clinical-state";
import { openSession } from "./navigation";
import type { Encounter, Patient } from "./types";

/**
 * The result waiting on a doctor: in live mode the server's newest unacknowledged one, else the fixture's.
 * `server` is passed in from `useServerData()`: a module read here would be cached by React Compiler.
 */
function pendingResult(server: ServerData) {
  return server ? newestResult(server.results) : PENDING_RESULT;
}

/** Today's visits: in live mode at the server's appointment times, else the fixtures. */
export function useDayPatients(patients: Patient[]) {
  const server = useServerData();
  const today = useServerDay(server ? localDate(new Date()) : undefined);
  return today ? serverDayPatients(patients, today) : patients;
}

/** The lines the home keys and the sidebar share, so both say the same thing. */
export const wardLine = (ward: { blocked: number; fit: number }) => ward.blocked ? `${ward.blocked} discharges blocked` : `${ward.fit} fit to go`;
export const auditLine = (audit: { count: number; risk: string }) => audit.count ? `${audit.count} ${audit.count === 1 ? "note" : "notes"} · ${audit.risk} at risk` : "All queries sent";
export const auditOf = (items: AuditItem[]) => ({ count: items.length, risk: shortRM(totalRisk(items)) });

/** The care inbox as the home key needs it: `on` in live mode, `allowed` for a role that reads it. */
type Messages = { on: boolean; allowed: boolean; waiting: number; urgent: number; line: string };

/** Home's quick keys; in live mode today's visits come at the server's appointment times. */
export function useHomeActions(patients: Patient[], encounters: Record<string, Encounter | undefined>) {
  const server = useServerData();
  const day = useDayPatients(patients);
  // The ward key counts bed 6 from Amelia's encounter, so it needs the server's record of it too.
  useServerEncounter(patients.find(p => p.id === DEMO_PATIENT));
  const role = useRole();
  const ack = { allowed: role.can("results.acknowledge"), failed: useAckFailed() };
  const audit = useOpenAudit();
  const training = useTrainingStatus();
  const messages = { ...useInboxSummary(), allowed: role.can("messages.inbox") };
  // Management's home leads with the ward card, so its keys are its own jobs, not clinical ones.
  if (role.role === "management") return managementActions(day, encounters, auditOf(audit), training.status ? trainingLine(training.status.counts) : undefined, training.status?.counts.blocked ?? 0);
  return homeActions(day, encounters, server, ack, messages);
}

/** Management's home keys: beds ready to go, the handover to read, money at risk in coding, and the training queue. */
export function managementActions(patients: Patient[], encounters: Record<string, Encounter | undefined>, audit: { count: number; risk: string }, training: string | undefined, trainingBlocked: number): QuickAction[] {
  const ward = wardSummary(wardBeds(patients, encounters));
  // Fit to go with nothing holding them: the blocked ones already lead the ward card above.
  const ready = Math.max(0, ward.fit - ward.blocked);
  return [
    { key: "fit", label: "Fit to go", icon: "checkmark.circle", status: ready ? `${ready} ready to discharge` : "None ready yet", tone: ready ? "good" : "calm", badge: ready, onPress: () => router.push({ pathname: "/ward", params: { filter: "fit" } }) },
    { key: "handover", label: "Hand over", icon: "arrow.left.arrow.right", status: `${patients.length} patients · read only`, onPress: () => router.push("/handover") },
    { key: "audit", label: "Coding audit", icon: "doc.text.magnifyingglass", status: auditLine(audit), tone: audit.count ? "caution" : "calm", badge: audit.count, onPress: () => router.push("/audit") },
    { key: "training", label: "Training data", icon: "shield.lefthalf.filled", status: training ?? "De-identified samples", tone: trainingBlocked ? "urgent" : "calm", badge: trainingBlocked, onPress: () => router.push("/training") },
  ];
}

type Ack = { allowed: boolean; failed?: { id: string; error: string } };

/** Home: where a clinician's day is, each tile with its live status. */
export function homeActions(patients: Patient[], encounters: Record<string, Encounter | undefined>, server: ServerData, ack: Ack = { allowed: true },
  messages: Messages = { on: false, allowed: true, waiting: 0, urgent: 0, line: "" }): QuickAction[] {
  const next = [...patients].sort((a, b) => a.time.localeCompare(b.time)).find(p => !encounters[p.id]?.requests.length);
  const ward = wardSummary(wardBeds(patients, encounters));
  const result = pendingResult(server);
  const resultFor = result && patients.find(p => p.id === result.patientId);
  // Opening a live result acknowledges it (doctors only), so it leaves the unacknowledged list for everyone.
  // A refusal is kept by acknowledgeResult and shown on the key; opening it again retries.
  const openResult = () => { if (!result || !resultFor) return; if (result.id && ack.allowed) void acknowledgeResult(result.id).catch(() => {}); openSession(resultFor.id, { next: "briefing" }); };
  const ackFailed = Boolean(result?.id && ack.failed?.id === result.id);
  return [
    { key: "patients", label: "Patients", icon: "person.2", status: next ? `Next ${next.name.split(" ")[0]} · ${next.time}` : `${patients.length} today`, badge: patients.length, onPress: () => router.push("/patients") },
    { key: "results", label: "Results", icon: "testtube.2", status: ackFailed ? "Not acknowledged · tap to retry" : result && resultFor ? `${result.flag} ${testInSentence(result.test)} · ${resultFor.name.split(" ")[0]}` : "Nothing new", tone: resultFor ? "urgent" : "calm", badge: resultFor ? 1 : 0, onPress: openResult },
    // Patients' messages from Sona Care; hand over stays in the sidebar. A role that can't read them keeps Hand over here.
    messages.allowed
      ? { key: "messages", label: "Messages", icon: "bubble.left.and.bubble.right", status: messages.on ? messages.line : "From Sona Care", tone: messages.urgent ? "urgent" : messages.waiting ? "caution" : "calm", badge: messages.waiting, onPress: () => router.push("/inbox") }
      : { key: "handover", label: "Hand over", icon: "arrow.left.arrow.right", status: `${patients.length + (server ? 0 : 3)} patients to hand over`, onPress: () => router.push("/handover") },
    // Tasks live in the top bar; the ward view is the one place to see every bed's blockers.
    { key: "ward", label: "Ward", icon: "bed.double", status: wardLine(ward), tone: ward.blocked ? "caution" : "calm", badge: ward.blocked, onPress: () => router.push("/ward") },
  ];
}

/**
 * Inside a visit (or its patient sheet): the four things asked most, badged from this patient's state,
 * and for doctors "Scan note" (a handwritten ward-round note, drug chart or letter into the record).
 */
export type VisitTarget = "briefing" | "recording" | "medication" | "xray" | "scan";

/** The one thing in this visit that needs the doctor now, with its action; nothing when nothing does. */
export type VisitNeed = { tone: "urgent" | "caution" | "calm"; text: string; action: string; target: VisitTarget | "discharge" | "claim" | "handover" };
export function visitNeed(patient: Patient, encounter: Encounter | undefined, server: ServerData): VisitNeed | undefined {
  if (pendingResult(server)?.patientId === patient.id) return { tone: "urgent", text: "New result to review", action: "Brief me", target: "briefing" };
  if (patient.incomplete) return { tone: "caution", text: "History incomplete · medicines and allergies unknown", action: "Brief me", target: "briefing" };
  const claim = encounter?.claim?.status;
  if (claim === "queried" || claim === "denied") return { tone: "caution", text: claim === "queried" ? "Insurer asked about the guarantee letter" : "Guarantee letter denied · appeal drafted", action: "Answer", target: "claim" };
  const unconfirmed = (encounter?.medicationEntries ?? defaultMedications(patient)).filter(m => !m.confirmed).length;
  const allergy = patient.allergies ? `${patient.allergies.split(" — ")[0]} allergy` : undefined;
  if (unconfirmed) return { tone: "caution", text: [`${unconfirmed} ${unconfirmed === 1 ? "medicine" : "medicines"} to confirm`, allergy].filter(Boolean).join(" · "), action: "Confirm", target: "medication" };
  // Once the medicines are settled the visit can close: discharge is the next move until it is done.
  if (!encounter?.discharge?.dischargedAt && encounter?.requests.length) return { tone: "calm", text: "Medicines confirmed · ready to draft the discharge", action: "Discharge", target: "discharge" };
  return undefined;
}
export function visitActions(patient: Patient, encounter: Encounter | undefined, server: ServerData, go: (target: VisitTarget) => void, scan = false): QuickAction[] {
  const unconfirmed = patient.incomplete ? 0 : (encounter?.medicationEntries ?? defaultMedications(patient)).filter(m => !m.confirmed).length;
  const resultHere = pendingResult(server)?.patientId === patient.id;
  const recording = encounter?.recording === "recording" || encounter?.recording === "paused";
  const lines = encounter?.transcript.length ?? 0;
  return [
    { key: "brief", label: "Brief me", icon: "text.alignleft", status: resultHere ? "New result to review" : patient.incomplete ? "History incomplete" : "Summary in seconds", tone: resultHere ? "urgent" : patient.incomplete ? "caution" : "calm", onPress: () => go("briefing") },
    { key: "consult", label: "Consultation", icon: "waveform", status: recording ? "Recording now" : lines ? `${lines} lines captured` : "Not started", tone: recording ? "caution" : "calm", onPress: () => go("recording") },
    { key: "meds", label: "Medicines", icon: "pills", status: patient.incomplete ? "Ingredient unknown" : unconfirmed ? `${unconfirmed} unconfirmed` : "All confirmed", tone: patient.incomplete || unconfirmed ? "caution" : "calm", badge: unconfirmed, onPress: () => go("medication") },
    { key: "xray", label: "X-ray", icon: "photo", status: encounter?.imagingAttachment ? "Image attached" : patient.incomplete ? "No image" : "Chest film on file", onPress: () => go("xray") },
    ...scan ? [{ key: "scan", label: "Scan note", icon: "doc.viewfinder", status: "Handwritten notes into the record", onPress: () => go("scan") }] : [],
  ];
}

/**
 * The visit's full tool row: the keys above plus the note, its follow-up tasks and discharge (when
 * this patient has a discharge plan), each with its state. Consultation and Note moved here from the sidebar.
 */
export function visitTools(patient: Patient, encounter: Encounter | undefined, server: ServerData, go: (target: VisitTarget) => void, scan: boolean, discharge: boolean): QuickAction[] {
  const [brief, consult, ...rest] = visitActions(patient, encounter, server, go, scan);
  const openTasks = encounter?.tasks.filter(t => !t.completed).length ?? 0;
  const drafted = Boolean(encounter?.note.trim() || encounter?.noteSections);
  return [brief!, consult!,
    { key: "note", label: "Note", icon: "doc.text", status: encounter?.noteReviewed ? "Reviewed" : drafted ? "Draft to review" : "Not started", tone: encounter?.noteReviewed ? "good" : drafted ? "caution" : "calm", onPress: () => router.push("/note") },
    ...rest,
    { key: "tasks", label: "Tasks", icon: "checklist", status: openTasks ? `${openTasks} open` : "None yet", badge: openTasks, onPress: () => router.push("/tasks") },
    ...discharge ? [{ key: "discharge", label: "Discharge", icon: "bed.double", status: encounter?.discharge?.dischargedAt ? "Discharged" : "Check what blocks it", tone: encounter?.discharge?.dischargedAt ? "good" as const : "calm" as const, onPress: () => router.push("/discharge") }] : [],
  ];
}
