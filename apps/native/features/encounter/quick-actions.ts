import { router } from "expo-router";
import type { QuickAction } from "@/components/sona/quick-actions";
import { PENDING_RESULT, testInSentence } from "@/features/day/model";
import { newestResult, serverDayPatients } from "@/features/live/day";
import { useRole } from "@/features/live/roles";
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

/** Home's quick keys; in live mode today's visits come at the server's appointment times. */
export function useHomeActions(patients: Patient[], encounters: Record<string, Encounter | undefined>) {
  const server = useServerData();
  const today = useServerDay(server ? localDate(new Date()) : undefined);
  // The ward key counts bed 6 from Amelia's encounter, so it needs the server's record of it too.
  useServerEncounter(patients.find(p => p.id === DEMO_PATIENT));
  const ack = { allowed: useRole().can("results.acknowledge"), failed: useAckFailed() };
  return homeActions(today ? serverDayPatients(patients, today) : patients, encounters, server, ack);
}

type Ack = { allowed: boolean; failed?: { id: string; error: string } };

/** Home: where a clinician's day is, each tile with its live status. */
export function homeActions(patients: Patient[], encounters: Record<string, Encounter | undefined>, server: ServerData, ack: Ack = { allowed: true }): QuickAction[] {
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
    { key: "handover", label: "Hand over", icon: "arrow.left.arrow.right", status: `${patients.length + (server ? 0 : 3)} patients to hand over`, onPress: () => router.push("/handover") },
    // Tasks live in the top bar; the ward view is the one place to see every bed's blockers.
    { key: "ward", label: "Ward", icon: "bed.double", status: ward.blocked ? `${ward.blocked} discharges blocked` : `${ward.fit} fit to go`, tone: ward.blocked ? "caution" : "calm", badge: ward.blocked, onPress: () => router.push("/ward") },
  ];
}

/** Inside a visit (or its patient sheet): the four things asked most, badged from this patient's state. */
export function visitActions(patient: Patient, encounter: Encounter | undefined, server: ServerData, go: (target: "briefing" | "recording" | "medication" | "xray") => void): QuickAction[] {
  const unconfirmed = patient.incomplete ? 0 : (encounter?.medicationEntries ?? defaultMedications(patient)).filter(m => !m.confirmed).length;
  const resultHere = pendingResult(server)?.patientId === patient.id;
  const recording = encounter?.recording === "recording" || encounter?.recording === "paused";
  const lines = encounter?.transcript.length ?? 0;
  return [
    { key: "brief", label: "Brief me", icon: "text.alignleft", status: resultHere ? "New result to review" : patient.incomplete ? "History incomplete" : "Summary in seconds", tone: resultHere ? "urgent" : patient.incomplete ? "caution" : "calm", onPress: () => go("briefing") },
    { key: "consult", label: "Consultation", icon: "waveform", status: recording ? "Recording now" : lines ? `${lines} lines captured` : "Not started", tone: recording ? "caution" : "calm", onPress: () => go("recording") },
    { key: "meds", label: "Medicines", icon: "pills", status: patient.incomplete ? "Ingredient unknown" : unconfirmed ? `${unconfirmed} unconfirmed` : "All confirmed", tone: patient.incomplete || unconfirmed ? "caution" : "calm", badge: unconfirmed, onPress: () => go("medication") },
    { key: "xray", label: "X-ray", icon: "photo", status: encounter?.imagingAttachment ? "Image attached" : patient.incomplete ? "No image" : "Chest film on file", onPress: () => go("xray") },
  ];
}
