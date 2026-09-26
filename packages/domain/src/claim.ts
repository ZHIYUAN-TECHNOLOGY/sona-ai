import { EMPTY_DISCHARGE, openLabels, type Approval, type Refusal } from "./discharge";
import type { Encounter, PrescriptionCheck } from "./types";

/**
 * Final guarantee letter request: suggested codes, each tied to the note sentence that justifies
 * it, the insurer's criteria as blockers fixed in place, then a send that a mock insurer approves.
 * Approval resolves the discharge card's guarantee-letter blocker.
 *
 * ponytail: authored fixture for the demo patient and a timed mock insurer. Codes come from a model
 * plus a terminology lookup later; criteria come from panel insurer documents stored as data.
 */
export type ClaimState = {
  organismConfirmed: boolean; ivReasonAdded: boolean; status: "draft" | "sent" | "approved" | "queried"; approvedAt?: string;
  /** Live mode: the insurer's review page while the letter is with them, and their question if they queried it. */
  reviewUrl?: string; query?: string;
};
export type Sentence = { id: string; text: string };
export type Code = { code: string; label: string; kind: "Principal" | "Secondary" | "Procedure"; evidence: string };

export const EMPTY_CLAIM: ClaimState = { organismConfirmed: false, ivReasonAdded: false, status: "draft" };
export const INSURER = "Synthetic insurer";
export const ESTIMATE = "RM 3,480";

const NOTE: Sentence[] = [
  { id: "presenting", text: "Five days of cough, fever since yesterday." },
  { id: "xray", text: "Chest film: right lower zone consolidation." },
  { id: "diagnosis", text: "Community-acquired pneumonia, CURB-65 0." },
  { id: "asthma", text: "Background asthma, on a salbutamol inhaler." },
  { id: "allergy", text: "Penicillin allergy reported, so azithromycin given." },
];
const ORGANISM: Sentence = { id: "organism", text: "Organism not identified; sputum culture not sent." };
const IV_REASON: Sentence = { id: "iv", text: "IV first: vomiting on arrival, unable to keep oral tablets down." };

export const CODES: Code[] = [
  { code: "J18.9", label: "Pneumonia, unspecified organism", kind: "Principal", evidence: "diagnosis" },
  { code: "J45.9", label: "Asthma, unspecified", kind: "Secondary", evidence: "asthma" },
  { code: "Z88.0", label: "Allergy status to penicillin", kind: "Secondary", evidence: "allergy" },
  { code: "87.44", label: "Routine chest X-ray", kind: "Procedure", evidence: "xray" },
];

/** The note excerpt the codes point into; a fix adds its sentence, so the evidence grows in place. */
export function noteFor(state: ClaimState): Sentence[] {
  return [...NOTE, ...(state.organismConfirmed ? [ORGANISM] : []), ...(state.ivReasonAdded ? [IV_REASON] : [])];
}

export function claimChecks(state: ClaimState): PrescriptionCheck[] {
  return [
    { id: "severity", label: "Severity score documented", status: "passed", detail: "CURB-65 0" },
    { id: "imaging", label: "Imaging result attached", status: "passed", detail: "Chest film report" },
    { id: "stay", label: "Stay within the approved plan", status: "passed", detail: "36 h of 3 days" },
    { id: "organism", label: "Organism documented", status: state.organismConfirmed ? "passed" : "blocked", detail: "J18.9 needs the note to say the organism is unknown" },
    { id: "iv", label: "Reason for IV antibiotics", status: state.ivReasonAdded ? "passed" : "blocked", detail: "The insurer asks why oral was not used first" },
  ];
}

export type ClaimReceipt = { status: "sent"; encounterId: string; requestId: string; approvedBy: string; sentAt: string };

/** Server rule: a claim goes to the insurer only with a named approver and every criterion met. */
export function decideClaimSend(state: ClaimState, command: Approval, at: Date): Refusal | ClaimReceipt {
  if (!command.approvedBy.trim()) return { status: "refused", reason: "unapproved", open: [] };
  const open = openLabels(claimChecks(state));
  if (open.length) return { status: "refused", reason: "blocked", open };
  const { encounterId, requestId, approvedBy } = command;
  return { status: "sent", encounterId, requestId, approvedBy, sentAt: at.toISOString() };
}

// ponytail: a fixed delay stands in for the insurer; a real panel insurer replies by webhook.
export const INSURER_DELAY_MS = 60_000;
/** The mock insurer as a pure function of time: approved once the delay has passed since sending. */
export function insurerDecision(sentAt: Date, now: Date): { status: "pending"; approvesAt: string } | { status: "approved"; approvedAt: string } {
  const due = new Date(sentAt.getTime() + INSURER_DELAY_MS);
  return now < due ? { status: "pending", approvesAt: due.toISOString() } : { status: "approved", approvedAt: due.toISOString() };
}

/** The mock insurer's approval: the claim closes and the discharge's guarantee letter resolves. */
export function approveClaim(encounter: Encounter, at: Date): Encounter {
  const claim = encounter.claim ?? EMPTY_CLAIM;
  return { ...encounter, claim: { ...claim, status: "approved", approvedAt: at.toISOString() }, discharge: { ...(encounter.discharge ?? EMPTY_DISCHARGE), glReceived: true } };
}
