import { readReply } from "@sona-ai/domain/check-ins";
import { CODES, type Code, type Sentence } from "@sona-ai/domain/claim";
import { draftByRules, triageByRules, type DraftPlan, type MessageLabel } from "@sona-ai/domain/messages";
import { planFor, type Language } from "@sona-ai/domain/discharge";
import type { Study } from "@sona-ai/domain/evidence";
import type { DetectedFinding } from "@sona-ai/domain/findings";
import { deidentifyByRules, type KnownIdentity, type Replacement } from "@sona-ai/domain/training";
import type { Patient } from "@sona-ai/domain/types";
import { huddle, type Bed, type Owner } from "@sona-ai/domain/ward";

/**
 * The one seam between the routes and the models (docs/delivery-plan.md, Models and hosting: on
 * hold). Routes call `context.models`; turning on Baseten means passing a real `Models` from the
 * Worker's context, nothing else. Every answer says where it came from, so a fixture can never be
 * shown as a model reading, and a model answer carries the model version for provenance.
 */
export type Origin = { source: "fixture" } | { source: "model"; model: string };
type Answer<T> = Promise<T & Origin>;

export type Models = {
  /** Brain (Gemma): what to know before seeing the patient. */
  briefing(input: { patient: Patient }): Answer<{ lines: string[] }>;
  reasoning(input: { patient: Patient; question: string }): Answer<{ answer: string; sourceIds: string[] }>;
  /** X-ray box: never a validated read in this demo. */
  xrayRead(input: { image: Uint8Array; contentType: string }): Answer<{ findings: string[]; validated: false }>;
  /** Demo flow 6: findings beyond the question asked, each with a box on the image (a real model's reply goes through `readBoxes`). Never validated. */
  incidentalFindings(input: { patientId: string; image?: Uint8Array; contentType?: string }): Answer<{ findings: DetectedFinding[]; validated: false }>;
  draftDischarge(input: { patient: Patient; language: Language }): Answer<{ summary: string; leaflet: string }>;
  suggestCodes(input: { sentences: Sentence[] }): Answer<{ codes: Code[] }>;
  synthesiseEvidence(input: { question: string; studies: Study[] }): Answer<{ answer: string; studyIds: string[] }>;
  huddleBrief(input: { beds: Bed[]; owners: Record<string, Owner | undefined> }): Answer<{ lines: string[] }>;
  /** Sona Care: the patient's speech as text (Malay, English, Chinese or mixed). The stub has no ears: it returns no text. */
  transcribe(input: { audio: Uint8Array; language?: Language }): Answer<{ text: string; language?: string }>;
  /**
   * Sona Care: an answer to the patient's question from their own discharge plan only. `grounded` false
   * means the plan does not answer it (the app offers the care team); `urgent` puts the 999 line first.
   * The stub answers nothing, so the app's authored plan answers stay in charge.
   */
  answerFromPlan(input: { question: string; plan: string; language: Language }): Answer<{ answer: string; grounded: boolean; urgent: boolean; from?: string }>;
  /** After-discharge check-ins: worse or urgent replies become a flagged task (with the model's short symptom, when it read one). */
  classifyReply(input: { text: string; language: Language }): Answer<{ label: "fine" | "worse" | "urgent"; symptom?: string }>;
  /** The care team's inbox: how soon a patient message needs a clinician (urgent, clinical, admin) and why, in a few words. */
  triageMessage(input: { text: string; language?: Language }): Answer<{ label: MessageLabel; reason: string }>;
  /**
   * The inbox's suggested reply to a patient message, for a person to check before sending: short and kind,
   * in the patient's language, never advice beyond their own plan (their medicines' lines and next visit).
   */
  draftReply(input: { text: string; label: MessageLabel; patientFirstName: string; plan?: DraftPlan; language: Language }): Answer<{ text: string }>;
  /**
   * Continuous training: the text with the patient's identifiers replaced by placeholders ([NAME], [IC],
   * [PHONE], [EMAIL], [MRN]). The leak gate re-checks whatever comes back, whoever wrote it.
   */
  deidentify(input: { text: string; known: KnownIdentity }): Answer<{ text: string; replacements: Replacement[] }>;
};

const fixture = <T>(value: T) => Promise.resolve({ ...value, source: "fixture" as const });

/** The authored claim codes, each found by the words that justify it (Amelia's note yields exactly CODES). */
const CODE_RULES: [RegExp, Omit<Code, "evidence">][] = [
  [/pneumonia/i, CODES[0]!], [/asthma/i, CODES[1]!], [/penicillin/i, CODES[2]!], [/chest (film|x-?ray)/i, CODES[3]!],
];

/** The app's authored content, served until the models come off hold. Nothing here reads its input the way a model would. */
export const stubModels: Models = {
  briefing: ({ patient }) => fixture({ lines: [
    patient.complaint,
    patient.allergies ? `Allergy recorded: ${patient.allergies.split(" — ")[0]}.` : "No allergy recorded; confirm before prescribing.",
    ...(patient.incomplete ? ["History is incomplete: onset, observations, allergies and medicines are still missing."] : []),
  ] }),
  reasoning: () => fixture({ answer: "Sample reasoning only: community-acquired pneumonia is the leading working diagnosis; confirm with a chest X-ray and CURB-65.", sourceIds: [] }),
  xrayRead: () => fixture({ findings: ["Findings unavailable: no model has read this image."], validated: false }),
  // ponytail: Amelia's authored findings stand in for MedGemma; any other patient gets none.
  incidentalFindings: ({ patientId }) => fixture({ validated: false, findings: patientId === "SYN-1042" ? [
    { kind: "nodule", label: "9 mm nodule, right upper zone", sizeMm: 9, location: { x: 0.34, y: 0.3, zone: "right upper zone", box: [0.26, 0.29, 0.34, 0.39] } },
    { kind: "cardiomegaly", label: "Borderline heart size", location: { x: 0.56, y: 0.62, zone: "cardiac silhouette", box: [0.45, 0.39, 0.79, 0.73] } },
  ] : [] }),
  // The patient's own plan (authored for Amelia, rule-built from the record for anyone else), as a model would draft it.
  draftDischarge: ({ patient, language }) => { const plan = planFor(patient); return fixture({ summary: plan.full, leaflet: plan.leaflet[language] }); },
  // ponytail: keyword rules stand in for OpenMed extraction; each code cites the first sentence that names it, and a note naming none gets none.
  suggestCodes: ({ sentences }) => fixture({ codes: CODE_RULES.flatMap(([re, code]) => {
    const evidence = sentences.find(s => re.test(s.text))?.id;
    return evidence ? [{ ...code, evidence }] : [];
  }) }),
  synthesiseEvidence: ({ studies }) => fixture({ answer: "Sample synthesis: no model has weighed these studies.", studyIds: studies.map(s => s.id) }),
  huddleBrief: ({ beds, owners }) => fixture({ lines: huddle(beds, owners) }),
  // ponytail: keyword rule standing in for the classifier; the demo reply is "fever returned".
  classifyReply: ({ text }) => fixture({ label: readReply(text) }),
  transcribe: () => fixture({ text: "" }),
  // ponytail: keyword rules and templates (packages/domain/messages) until a model triages and drafts.
  triageMessage: ({ text }) => fixture(triageByRules(text)),
  draftReply: input => fixture({ text: draftByRules(input) }),
  // ponytail: full names, IC, phone, email and MRN by rule (packages/domain/training); OpenMed's clinical PII model replaces it, and catches first names too.
  deidentify: ({ text, known }) => fixture(deidentifyByRules(text, known)),
  answerFromPlan: () => fixture({ answer: "", grounded: false, urgent: false }),
};
