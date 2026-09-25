import { router } from "expo-router";
import type { QuickAction } from "@/components/sona/quick-actions";
import { PENDING_RESULT } from "@/features/day/model";
import { defaultMedications } from "./clinical-state";
import { openSession } from "./navigation";
import type { Encounter, Patient } from "./types";

/** Home: where a clinician's day is, each tile with its live status. */
export function homeActions(patients: Patient[], encounters: Record<string, Encounter | undefined>): QuickAction[] {
  const next = [...patients].sort((a, b) => a.time.localeCompare(b.time)).find(p => !encounters[p.id]?.requests.length);
  const open = Object.values(encounters).reduce((n, e) => n + (e?.tasks.filter(t => !t.completed).length ?? 0), 0);
  const resultFor = patients.find(p => p.id === PENDING_RESULT.patientId);
  return [
    { key: "patients", label: "Patients", icon: "person.2", status: next ? `Next ${next.name.split(" ")[0]} · ${next.time}` : `${patients.length} today`, badge: patients.length, onPress: () => router.push("/patients") },
    { key: "results", label: "Results", icon: "testtube.2", status: resultFor ? `${PENDING_RESULT.flag} ${PENDING_RESULT.test.toLowerCase()} · ${resultFor.name.split(" ")[0]}` : "Nothing new", tone: resultFor ? "urgent" : "calm", badge: resultFor ? 1 : 0, onPress: () => resultFor && openSession(resultFor.id, { next: "briefing" }) },
    { key: "handover", label: "Hand over", icon: "arrow.left.arrow.right", status: `${patients.length + 3} patients to hand over`, onPress: () => router.push("/handover") },
    { key: "tasks", label: "Tasks", icon: "checklist", status: open ? `${open} open` : "All clear", tone: open ? "caution" : "calm", badge: open, onPress: () => router.push("/tasks") },
  ];
}

/** Inside a visit (or its patient sheet): the four things asked most, badged from this patient's state. */
export function visitActions(patient: Patient, encounter: Encounter | undefined, go: (target: "briefing" | "recording" | "medication" | "xray") => void): QuickAction[] {
  const unconfirmed = patient.incomplete ? 0 : (encounter?.medicationEntries ?? defaultMedications(patient)).filter(m => !m.confirmed).length;
  const recording = encounter?.recording === "recording" || encounter?.recording === "paused";
  const lines = encounter?.transcript.length ?? 0;
  return [
    { key: "brief", label: "Brief me", icon: "text.alignleft", status: PENDING_RESULT.patientId === patient.id ? "New result to review" : patient.incomplete ? "History incomplete" : "Summary in seconds", tone: PENDING_RESULT.patientId === patient.id ? "urgent" : patient.incomplete ? "caution" : "calm", onPress: () => go("briefing") },
    { key: "consult", label: "Consultation", icon: "waveform", status: recording ? "Recording now" : lines ? `${lines} lines captured` : "Not started", tone: recording ? "caution" : "calm", onPress: () => go("recording") },
    { key: "meds", label: "Medicines", icon: "pills", status: patient.incomplete ? "Ingredient unknown" : unconfirmed ? `${unconfirmed} unconfirmed` : "All confirmed", tone: patient.incomplete || unconfirmed ? "caution" : "calm", badge: unconfirmed, onPress: () => go("medication") },
    { key: "xray", label: "X-ray", icon: "photo", status: encounter?.imagingAttachment ? "Image attached" : patient.incomplete ? "No image" : "Chest film on file", onPress: () => go("xray") },
  ];
}
