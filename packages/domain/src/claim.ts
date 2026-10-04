import { EMPTY_DISCHARGE, openLabels, type Approval, type Refusal } from "./discharge";
import type { Encounter, PrescriptionCheck } from "./types";

/**
 * Final guarantee letter request: suggested codes, each tied to the note sentence that justifies
 * it, the insurer's criteria as blockers fixed in place, then a send that a mock insurer approves.
 * Approval resolves the discharge card's guarantee-letter blocker.
 *
 * Connected, the letter is built on the visit's saved note: the criteria are read against its sentences
 * and a fix is a sentence the doctor saves to it. No amount is shown: no table records what was billed.
 * ponytail: sample mode keeps a fixture note (NOTE, CODES) and a timed mock insurer. Criteria are keyword
 * rules over the note until a model reads the panel insurer's documents against it.
 */
export type ClaimStatus = "draft" | "sent" | "approved" | "queried" | "denied" | "appealed";
export type ClaimState = {
  /** Sample mode's two fixes (each adds its sentence to the fixture note); connected, a fix is saved to the visit's note instead. */
  organismConfirmed: boolean; ivReasonAdded: boolean; status: ClaimStatus; approvedAt?: string;
  /** Live mode: the insurer's review page while the letter is with them, and their question if they queried it. */
  reviewUrl?: string; query?: string;
  /** The insurer's denial (kept once appealed, so the history reads "denied, then appealed"), and when the appeal went. */
  denial?: Denial; appealedAt?: string;
  /** Live mode: who suggested the codes frozen into the letter that went, and who drafted the appeal that went (claim.status). */
  codedBy?: KeptBy; appealDraftedBy?: KeptBy;
};
/** Who made something kept as sent: a model by name, the rules ("fixture"), or "unknown" on a row from before this was kept. */
export type KeptBy = { source: "model"; model: string } | { source: "fixture" } | { source: "unknown" };
export type DenialCode = "PEC" | "MED" | "DOC" | "COV";
export type Denial = { code: DenialCode; reason: string; note?: string; at: string };
/** An appeal letter: every point cites the note sentence behind it, so nothing in it is ungrounded. */
export type AppealLetter = { opening: string; points: { claim: string; evidenceSentenceId: string }[]; closing: string };
export type Sentence = { id: string; text: string };
export type Code = { code: string; label: string; kind: "Principal" | "Secondary" | "Procedure"; evidence: string };

export const EMPTY_CLAIM: ClaimState = { organismConfirmed: false, ivReasonAdded: false, status: "draft" };
export const INSURER = "Synthetic insurer";

// Sample mode's note for the demo patient. Connected, the letter reads her visit's saved note instead: the seed saves
// one for her stay (packages/db seedDemoNote), and a note saved from her consultation is its next revision.
const NOTE: Sentence[] = [
  { id: "presenting", text: "Five days of cough, fever since yesterday." },
  { id: "xray", text: "Chest film: right lower zone consolidation." },
  { id: "diagnosis", text: "Community-acquired pneumonia, CURB-65 0." },
  { id: "asthma", text: "Background asthma, on a salbutamol inhaler." },
  { id: "allergy", text: "Penicillin allergy reported, so IV azithromycin given." },
];
const IV_REASON: Sentence = { id: "iv", text: "IV first: vomiting on arrival, unable to keep oral tablets down." };

export const CODES: Code[] = [
  { code: "J18.9", label: "Pneumonia, unspecified organism", kind: "Principal", evidence: "diagnosis" },
  { code: "J45.9", label: "Asthma, unspecified", kind: "Secondary", evidence: "asthma" },
  { code: "Z88.0", label: "Allergy status to penicillin", kind: "Secondary", evidence: "allergy" },
  { code: "87.44", label: "Routine chest X-ray", kind: "Procedure", evidence: "xray" },
];

/** Sample mode's note; a fix adds its sentence, so the evidence grows in place. */
export function noteFor(state: ClaimState): Sentence[] {
  return [...NOTE, ...(state.organismConfirmed ? [ORGANISM_UNKNOWN] : []), ...(state.ivReasonAdded ? [IV_REASON] : [])];
}

/**
 * The sentence each fix saves to the note. Its ID is the criterion it answers, and the IV reason is the doctor's own
 * words after "IV first:", so it still reads as the reason once the note is edited as a whole.
 */
export const ORGANISM_UNKNOWN: Sentence = { id: "organism", text: "Organism not identified." };
export const ivReason = (why: string): Sentence => ({ id: "iv", text: `IV first: ${why.trim()}` });

type Criterion = { id: string; label: string; applies?: RegExp; met: RegExp; missing: string };
/**
 * The synthetic insurer's criteria as rules over the note. `applies`: only a note that says so calls for it.
 * ponytail: keywords stand in for a model reading the insurer's policy (the same rules are rows in insurer_criteria).
 * The policy's length-of-stay limit is not judged: no table records when an admission began.
 */
const CRITERIA: Criterion[] = [
  { id: "severity", label: "Severity score documented", met: /CURB-65|CRB-65|qSOFA|NEWS2?\b|severity score/i, missing: "No severity score in the note" },
  { id: "imaging", label: "Imaging result attached", met: /chest film|x-?ray|radiograph|ultrasound|\bCT\b|\bMRI\b|echocardiogra/i, missing: "No imaging result in the note" },
  { id: "organism", label: "Organism documented", applies: /pneumonia/i, met: /organism|culture/i, missing: "J18.9 needs the note to say the organism is unknown" },
  // IV and its reason in one sentence: "IV azithromycin given" alone says what was given, not why oral was not.
  { id: "iv", label: "Reason for IV antibiotics", applies: /\bIV\b|intravenous/i, met: /^(?=.*(\bIV\b|intravenous))(?=.*(IV first:|because|unable|vomit|could not|not tolerat|nil by mouth))/i, missing: "The insurer asks why oral was not used first" },
];
// A saved note keeps a whole section in one entry, so each of its sentences is read by itself and only the one that says it is quoted.
const sentencesOf = (s: Sentence) => s.text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);

/** Each criterion read against the note: met by a sentence that says it (quoted as the detail), blocked until one does. */
export function claimChecks(note: Sentence[]): PrescriptionCheck[] {
  const text = note.map(s => s.text).join(" ");
  return CRITERIA.filter(c => !c.applies || c.applies.test(text)).map(c => {
    const said = note.flatMap(s => s.id === c.id ? [s.text] : sentencesOf(s).filter(t => c.met.test(t)))[0];
    return { id: c.id, label: c.label, status: said ? "passed" as const : "blocked" as const, detail: said ? `“${said}”` : c.missing };
  });
}

export type ClaimReceipt = { status: "sent"; encounterId: string; requestId: string; approvedBy: string; sentAt: string };

/** Server rule: a claim goes to the insurer only with a named approver and every criterion met by the note. */
export function decideClaimSend(note: Sentence[], command: Approval, at: Date): Refusal | ClaimReceipt {
  if (!command.approvedBy.trim()) return { status: "refused", reason: "unapproved", open: [] };
  const open = openLabels(claimChecks(note));
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

/** The synthetic insurer's denial reasons, as the review page offers them (realistic, fictional). */
export const DENIAL_REASONS: { code: DenialCode; reason: string }[] = [
  { code: "PEC", reason: "Pre-existing condition not disclosed" },
  { code: "MED", reason: "Admission not medically necessary" },
  { code: "DOC", reason: "Documentation incomplete: organism / severity not stated" },
  { code: "COV", reason: "Outside policy coverage period" },
];

/** Per denial: the points worth making, each kept only when a note sentence says it (the first sentence matching). */
const APPEAL_RULES: Record<DenialCode, { points: [RegExp, string][]; closing: string }> = {
  PEC: { points: [
    [/pneumonia/i, "The admission was for community-acquired pneumonia, a new acute infection diagnosed on this admission."],
    [/cough|fever/i, "The illness was recent: cough for five days and fever since the day before admission."],
    [/asthma/i, "Asthma is recorded openly in the note as background history; it was not the reason for admission."],
  ], closing: "The admission treated a new, acute infection, not an undisclosed condition. We ask that the denial be withdrawn and the final guarantee letter approved." },
  MED: { points: [
    [/consolidation|chest (film|x-?ray)/i, "The chest film showed right lower zone consolidation, confirming pneumonia."],
    [/vomiting|oral tablets/i, "She was vomiting on arrival and could not keep oral tablets down, so antibiotics had to start intravenously, which needs admission."],
    [/penicillin|allergy/i, "A penicillin allergy narrowed the antibiotic choice, so the first doses were given under observation."],
  ], closing: "Admission was needed to give antibiotics safely. We ask that the denial be withdrawn and the final guarantee letter approved." },
  DOC: { points: [
    [/organism/i, "The organism is documented as not identified. J18.9 is the code for pneumonia with an unidentified organism."],
    [/CURB-65/i, "Severity is documented: CURB-65 score 0, recorded with the diagnosis."],
    [/consolidation|chest (film|x-?ray)/i, "The imaging result is documented: right lower zone consolidation on the chest film."],
  ], closing: "The organism and severity are both in the note. We ask that the claim be reassessed on the documentation attached and the final guarantee letter approved." },
  COV: { points: [
    [/cough|fever/i, "The illness began five days before admission, and the admission followed directly from it."],
    [/pneumonia/i, "Community-acquired pneumonia was diagnosed on this admission, not before it."],
  ], closing: "Please check the policy dates against the admission date on the note. We ask that the denial be withdrawn and the final guarantee letter approved." },
};

/**
 * The appeal as authored rules write it: calm, per denial reason, every point grounded in a real note
 * sentence (a point whose words the note lacks is left out, never invented).
 * ponytail: rules over the demo note stand in for the appeal model (see packages/api/src/models.ts).
 */
export function appealByRules(input: { denialCode: DenialCode; denialReason: string; sentences: Sentence[]; patient: { name: string } }): AppealLetter {
  const rules = APPEAL_RULES[input.denialCode];
  const points = rules.points.flatMap(([re, claim]) => { const s = input.sentences.find(x => re.test(x.text)); return s ? [{ claim, evidenceSentenceId: s.id }] : []; });
  return {
    opening: `We ask ${INSURER} to review its denial of the final guarantee letter for ${input.patient.name} (“${input.denialReason}”). The note written during the admission shows:`,
    points, closing: rules.closing,
  };
}

/** The mock insurer's approval: the claim closes and the discharge's guarantee letter resolves. */
export function approveClaim(encounter: Encounter, at: Date): Encounter {
  const claim = encounter.claim ?? EMPTY_CLAIM;
  return { ...encounter, claim: { ...claim, status: "approved", approvedAt: at.toISOString() }, discharge: { ...(encounter.discharge ?? EMPTY_DISCHARGE), glReceived: true } };
}
