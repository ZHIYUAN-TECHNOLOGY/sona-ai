import { z } from "zod";
import { newEncounter, patients } from "./fixtures";
import { defaultMedications, getPrescriptionChecks, simulatedRegimen } from "./clinical-state";
export { getPrescriptionChecks } from "./clinical-state";
import type { Capability, Encounter, Patient, RequestState, ResponseCard } from "./types";

export const capabilitySchema = z.enum(["briefing", "reasoning", "xray", "medication", "prescription", "followup", "note", "evidence"]);
export const cardSchema = z.object({ id: z.string(), kind: capabilitySchema, requestId: z.string(), patientId: z.string(), encounterId: z.string(), revision: z.number().int().positive(), sections: z.number().int().min(1).max(3).optional() });
export function routePrompt(prompt: string): Capability | null {
  if (/steroid|evidence|guideline|trial|should .+ (get|have|receive)/i.test(prompt)) return "evidence";
  if (/prescrib|prescription|regimen|treatment plan/i.test(prompt)) return "prescription";
  if (/interact|medicat|drug|allerg/i.test(prompt)) return "medication";
  if (/x.?ray|image|radiograph/i.test(prompt)) return "xray";
  if (/diagnos|reason|differential|possibilit/i.test(prompt)) return "reasoning";
  if (/follow.?up|task|appointment/i.test(prompt)) return "followup";
  if (/note|summari[sz]e.*consult/i.test(prompt)) return "note";
  if (/brief|history|patient|summary|timeline|review|know before|before i see/i.test(prompt)) return "briefing";
  return null;
}
export function acceptCard(encounter: Encounter, patient: Patient, payload: unknown): Encounter {
  const parsed = cardSchema.safeParse(payload);
  if (!parsed.success) return encounter;
  const card = parsed.data;
  const request = encounter.requests.find(item => item.id === card.requestId);
  if (card.patientId !== patient.id || card.encounterId !== patient.encounterId || card.revision !== encounter.revision || !request || request.status !== "streaming" || request.kind !== card.kind || request.patientId !== card.patientId || request.encounterId !== card.encounterId || request.revision !== card.revision || encounter.cards.some(item => item.id === card.id)) return encounter;
  return { ...encounter, cards: [...encounter.cards, { ...card, imagingSnapshot: { imagingAttachment: encounter.imagingAttachment ? { ...encounter.imagingAttachment } : undefined, hideTeachingImage: encounter.hideTeachingImage, imagingScenario: encounter.imagingScenario }, patientSnapshot: { ...patient, history: [...patient.history], medicines: [...patient.medicines], sources: patient.sources.map(source => ({ ...source })), vitals: patient.vitals.map(vital => ({ ...vital })) }, transcriptSnapshot: encounter.transcript.map(line => ({ ...line })) }] };
}
export function beginRequest(encounter: Encounter, request: RequestState): Encounter {
  return { ...encounter, requests: [...encounter.requests.map(item => item.status === "streaming" ? { ...item, status: "cancelled" as const } : item), request] };
}
export function revealSections(encounter: Encounter, requestId: string, sections: number): Encounter {
  const request = encounter.requests.find(item => item.id === requestId);
  if (!request || request.status !== "streaming" || request.revision !== encounter.revision || !Number.isInteger(sections) || sections < 1 || sections > 3) return encounter;
  return { ...encounter, cards: encounter.cards.map(card => card.requestId === requestId && card.patientId === request.patientId && card.encounterId === request.encounterId ? { ...card, sections: Math.max(card.sections ?? 1, sections) } : card) };
}
export function finishRequest(encounter: Encounter, id: string, status: RequestState["status"], error?: string): Encounter {
  return { ...encounter, requests: encounter.requests.map(item => item.id === id && item.status === "streaming" ? { ...item, status, error } : item) };
}
export function reviseEncounter(encounter: Encounter): Encounter {
  return { ...encounter, revision: encounter.revision + 1, medicationCheckedRevision: undefined, reviewInvalidated: encounter.medicationCheckedRevision !== undefined || encounter.reviewInvalidated, amendmentOperation: encounter.amendmentOperation && !["complete", "failed", "cancelled"].includes(encounter.amendmentOperation.phase) ? { ...encounter.amendmentOperation, phase: "cancelled", error: "Clinical context changed. The prior receipt is unchanged; rerun the amendment." } : encounter.amendmentOperation, requests: encounter.requests.map(item => item.status === "streaming" ? { ...item, status: "cancelled" } : item) };
}
export function issueSimulation(encounter: Encounter, patient: Patient, operationId: string): Encounter {
  if (encounter.prescription?.id === operationId && encounter.prescription.status === "created") return encounter;
  if (encounter.prescription?.revision === encounter.revision && encounter.prescription.status === "created") return encounter;
  const checks = getPrescriptionChecks(encounter, patient);
  const reasons = checks.filter(c => c.status === "blocked").map(c => c.detail);
  const failed = !reasons.length && encounter.prescriptionScenario === "creation-failure";
  const previous = encounter.cards.map(c => c.prescription).findLast(p => p?.status === "created");
  const createdAt = new Date().toISOString();
  return { ...encounter, prescription: {
    id: operationId, revision: encounter.revision, status: reasons.length ? "blocked" : failed ? "failed" : "created",
    reasons: failed ? ["The simulated order could not be saved. Retry keeps the same operation identifier."] : reasons,
    createdAt, regimen: { ...simulatedRegimen }, checks, inputs: encounter.prescriptionInputs ? { ...encounter.prescriptionInputs } : undefined,
    supersedes: previous && previous.revision !== encounter.revision ? previous.id : undefined,
    audit: ["Automatic fixture workflow v2 · no live model inference", `Patient ${patient.id} · encounter ${patient.encounterId} · revision ${encounter.revision}`, `Evidence: ${simulatedRegimen.sourceVersion}`, `Indication provenance: intake/history + recorded observations`, ...checks.map(c => `${c.label}: ${c.status} — ${c.detail}`), ...(encounter.prescriptionAmendment ? [`Amendment reason: ${encounter.prescriptionAmendment}`] : []), `Operation ${operationId} · ${createdAt}`, reasons.length ? "Creation blocked" : failed ? "Creation failed; no receipt issued" : "Simulated AI-created receipt; no clinician approval gate; no pharmacy transmission"],
  } };
}
export const initialEncounters = (): Record<string, Encounter> => Object.fromEntries(patients.map(patient => [patient.id, { ...newEncounter(), medicationEntries: defaultMedications(patient) }]));

export function createCard(request: RequestState): ResponseCard { return { id: `${request.id}-result`, kind: request.kind, requestId: request.id, patientId: request.patientId, encounterId: request.encounterId, revision: request.revision }; }

export function queueAmendment(encounter: Encounter, reason: string, id: string): Encounter {
  if (!reason.trim() || encounter.requests.some(r => r.status === "streaming") || !encounter.cards.some(c => c.prescription?.status === "created")) return encounter;
  const revised = reviseEncounter(encounter);
  return { ...revised, prescriptionAmendment: reason.trim(), amendmentOperation: { id, revision: revised.revision, phase: "queued-review" } };
}
export function reconcileAmendment(encounter: Encounter, requestId: string): Encounter {
  const operation = encounter.amendmentOperation;
  if (!operation || operation.requestId !== requestId || operation.revision !== encounter.revision) return encounter;
  const request = encounter.requests.find(r => r.id === requestId);
  if (!request || request.status === "streaming") return encounter;
  if (request.status === "cancelled" || request.status === "failed") return { ...encounter, amendmentOperation: { ...operation, phase: request.status, error: "Amendment stopped. Your earlier receipt is retained. Restore the fixture and retry." } };
  if (operation.phase === "reviewing" && request.kind === "medication" && encounter.medicationCheckedRevision === encounter.revision) return { ...encounter, amendmentOperation: { ...operation, phase: "queued-issue", requestId: undefined } };
  if (operation.phase === "issuing" && request.kind === "prescription") return { ...encounter, amendmentOperation: { ...operation, phase: encounter.prescription?.status === "created" ? "complete" : "failed", error: encounter.prescription?.status === "created" ? undefined : "Amendment could not be created. Inspect the latest check result; the earlier receipt is unchanged." } };
  return encounter;
}
