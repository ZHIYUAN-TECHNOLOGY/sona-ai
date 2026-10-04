import { z } from "zod";
import { newEncounter, patients } from "./fixtures";
import { defaultMedications, getPrescriptionChecks, regimenLine, regimenOf } from "./clinical-state";
export { getPrescriptionChecks } from "./clinical-state";
import type { Capability, Encounter, Patient, Regimen, RequestState, ResponseCard } from "./types";

const REGIMEN_FIELDS = ["medication", "formulation", "dose", "unit", "route", "frequency", "duration", "indication", "sourceId", "sourceVersion"] as const;

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
/** A question typed right after an evidence answer continues that thread when no other capability claims it. */
export function routeInThread(prompt: string, last?: Capability): Capability | null {
  return routePrompt(prompt) ?? (last === "evidence" ? "evidence" : null);
}
export function acceptCard(encounter: Encounter, patient: Patient, payload: unknown): Encounter {
  const parsed = cardSchema.safeParse(payload);
  if (!parsed.success) return encounter;
  const card = parsed.data;
  const request = encounter.requests.find(item => item.id === card.requestId);
  if (card.patientId !== patient.id || card.encounterId !== patient.encounterId || card.revision !== encounter.revision || !request || request.status !== "streaming" || request.kind !== card.kind || request.patientId !== card.patientId || request.encounterId !== card.encounterId || request.revision !== card.revision || encounter.cards.some(item => item.id === card.id)) return encounter;
  return { ...encounter, cards: [...encounter.cards, { ...card, imagingSnapshot: { imagingAttachment: encounter.imagingAttachment ? { ...encounter.imagingAttachment } : undefined, hideTeachingImage: encounter.hideTeachingImage, imagingScenario: encounter.imagingScenario }, patientSnapshot: { ...patient, history: [...patient.history], medicines: [...patient.medicines], sources: patient.sources.map(source => ({ ...source })), vitals: patient.vitals.map(vital => ({ ...vital })) }, transcriptSnapshot: encounter.transcript.map(line => ({ ...line })) }] };
}
/**
 * The same question sent again while its answer is still coming, or within 2 s of the first (a double
 * tap on send, a suggestion or "Also ask"), is the same request, not a second answer. Request ids start
 * with their creation time (`request-<ms>-…`).
 */
export function isRepeat(last: Pick<RequestState, "id" | "kind" | "prompt" | "status"> | undefined, kind: Capability, prompt: string, now = Date.now()) {
  if (!last || last.kind !== kind || last.prompt.trim() !== prompt.trim()) return false;
  const at = Number(last.id.split("-")[1]);
  return last.status === "streaming" || (Number.isFinite(at) && now - at < 2000);
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
/** A receipt the server wrote (live mode): its id, time, revision and approver there, the regimen it recorded, and for an amendment the receipt it supersedes. */
export type ServerReceipt = { id: string; requestId: string; revision: number; createdAt: Date | string; approvedBy?: string; payload: unknown };
/**
 * The outcome of Prescribe on this visit. Live: the server's receipt, with the regimen it recorded. Sample mode: this phone's
 * own run of the checks on what was entered here; nothing is saved to a hospital record, and the audit says so.
 */
export function issueSimulation(encounter: Encounter, patient: Patient, operationId: string, server?: ServerReceipt): Encounter {
  if (encounter.prescription?.id === operationId && encounter.prescription.status === "created") return encounter;
  if (encounter.prescription?.revision === encounter.revision && encounter.prescription.status === "created") return encounter;
  const checks = getPrescriptionChecks(encounter, patient);
  // The server's receipt is the outcome: it ran the same checks on its own record before it wrote one.
  const reasons = server ? [] : checks.filter(c => c.status === "blocked").map(c => c.detail);
  const failed = !server && !reasons.length && encounter.prescriptionScenario === "creation-failure";
  const previous = encounter.cards.map(c => c.prescription).findLast(p => p?.status === "created");
  const recorded = server?.payload as (Partial<Regimen> & { amendment?: { supersedes?: string } }) | undefined;
  const createdAt = new Date(server?.createdAt ?? Date.now()).toISOString();
  // The regimen entered for this patient: as the server recorded it, else as this phone holds it. Never a stock one.
  const regimen = recorded?.medication ? Object.fromEntries(REGIMEN_FIELDS.map(key => [key, recorded[key]])) as Regimen : regimenOf(encounter, patient);
  return { ...encounter, prescription: {
    id: operationId, revision: encounter.revision, status: reasons.length ? "blocked" : failed ? "failed" : "created",
    reasons: failed ? ["The prescription could not be saved. Retry keeps the same operation identifier."] : reasons,
    createdAt, regimen, checks, inputs: encounter.prescriptionInputs ? { ...encounter.prescriptionInputs } : undefined,
    supersedes: recorded?.amendment?.supersedes ?? (previous && previous.revision !== encounter.revision ? previous.id : undefined),
    audit: [
      server ? `Recorded in the visit record on the server · receipt ${server.id} · server revision ${server.revision}${server.approvedBy ? ` · prescribed by ${(server as { approvedByName?: string }).approvedByName ?? server.approvedBy}` : ""}` : "Sample mode · checked on this phone; nothing was saved to a hospital record",
      `Patient ${patient.id} · encounter ${patient.encounterId} · revision ${encounter.revision}`,
      ...(regimen ? [`Regimen entered by the clinician: ${regimenLine(regimen)}`, `Indication: ${regimen.indication}`, `Dose limits: ${regimen.sourceVersion}`] : ["No regimen entered"]),
      ...checks.map(c => `${c.label}: ${c.status} — ${c.detail}`), ...(encounter.prescriptionAmendment ? [`Amendment reason: ${encounter.prescriptionAmendment}`] : []), `Operation ${operationId} · ${createdAt}`,
      reasons.length ? "Not prescribed: blocked by the checks above" : failed ? "Not prescribed: the prescription could not be saved" : "Checked by Sona's rules, not by a model; not sent to a pharmacy; nothing dispensed",
    ],
  } };
}
/** Each patient's visit as it starts: nothing asked yet, and the medicines their record lists (sample mode: the fixture roster). */
export const initialEncounters = (roster: Patient[] = patients): Record<string, Encounter> => Object.fromEntries(roster.map(patient => [patient.id, { ...newEncounter(), medicationEntries: defaultMedications(patient) }]));
/**
 * Judge build: a visit for each patient the server's roster brought that has none yet, started from that
 * patient's own record. Visits already under way are kept, and the same object comes back when nobody is new.
 */
export function withRoster(encounters: Record<string, Encounter>, roster: Patient[]): Record<string, Encounter> {
  const fresh = roster.filter(patient => !encounters[patient.id]);
  return fresh.length ? { ...encounters, ...initialEncounters(fresh) } : encounters;
}

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
