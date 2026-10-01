import { readReply } from "@sona-ai/domain/check-ins";
import { CODES, appealByRules, type AppealLetter, type Code, type DenialCode, type Sentence } from "@sona-ai/domain/claim";
import { draftByRules, triageByRules, type DraftPlan, type MessageLabel } from "@sona-ai/domain/messages";
import { planFor, type Language } from "@sona-ai/domain/discharge";
import type { Claim } from "@sona-ai/domain/evidence";
import type { DetectedFinding } from "@sona-ai/domain/findings";
import { deidentifyByRules, type KnownIdentity, type Replacement } from "@sona-ai/domain/training";
import { SAMPLE_NOTE, type HandwrittenNote } from "@sona-ai/domain/scan";
import type { Patient } from "@sona-ai/domain/types";
import { huddle, type Bed, type Owner } from "@sona-ai/domain/ward";

import { ruleNote, type ConsultationLine, type ScribeDraft } from "./scribe-model";

/**
 * The one seam between the routes and the models (docs/delivery-plan.md, Models and hosting: on
 * hold). Routes call `context.models`; turning on Baseten means passing a real `Models` from the
 * Worker's context, nothing else. Every answer says where it came from, so a fixture can never be
 * shown as a model reading, and a model answer carries the model version for provenance. `waking` is on a
 * fixture only while the box that would answer is starting: whole minutes (at least 1) until it should be ready.
 */
export type Origin = { source: "fixture"; waking?: number } | { source: "model"; model: string };
type Answer<T> = Promise<T & Origin>;

export type Models = {
  /** Brain (Gemma): what to know before seeing the patient. */
  briefing(input: { patient: Patient }): Answer<{ lines: string[] }>;
  reasoning(input: { patient: Patient; question: string }): Answer<{ answer: string; sourceIds: string[] }>;
  /** X-ray box: never a validated read in this demo. */
  xrayRead(input: { image: Uint8Array; contentType: string }): Answer<{ findings: string[]; validated: false }>;
  /** Demo flow 6: findings beyond the question asked, each with a box on the image (a real model's reply goes through `readBoxes`). Never validated. */
  incidentalFindings(input: { patientId: string; image?: Uint8Array; contentType?: string }): Answer<{ findings: DetectedFinding[]; validated: false }>;
  /** `summary` is the full text; `lines` the three-line summary when a model wrote it (the app shows the plan's own lines otherwise). */
  draftDischarge(input: { patient: Patient; language: Language }): Answer<{ summary: string; leaflet: string; lines?: { diagnosis: string; course: string; plan: string } }>;
  /** `candidates`: WHO ICD-10 table hits for the note (the route looks them up for a hosted model; the stub's rules need none). */
  suggestCodes(input: { sentences: Sentence[]; candidates?: { code: string; label: string }[] }): Answer<{ codes: Code[] }>;
  /**
   * An appeal against the insurer's denial of the final guarantee letter, for the doctor to check and edit
   * before sending: calm, answering the denial reason, each point citing the note sentence behind it
   * (the route drops any point citing a sentence the note lacks).
   */
  draftAppeal(input: { denialReason: string; denialCode: DenialCode; codes: Code[]; sentences: Sentence[]; patient: { name: string } }): Answer<{ letter: AppealLetter }>;
  /**
   * The evidence answer from numbered sources only: 2–4 short claims, each citing at least one source
   * number, the strength said in words from each source's design (never a dose or number a source
   * lacks), and up to 3 follow-ups the sources could answer. `thread` is the earlier turns, oldest
   * first. The route drops any claim citing nothing or a number not in `sources`.
   */
  synthesiseEvidence(input: { question: string; thread: { question: string; answer: string }[]; sources: { n: number; design: string; year?: number; title: string; text: string }[] }): Answer<{ claims: Claim[]; followUps: string[] }>;
  huddleBrief(input: { beds: Bed[]; owners: Record<string, Owner | undefined> }): Answer<{ lines: string[] }>;
  /** Sona Care: the patient's speech as text (Malay, English, Chinese or mixed). The stub has no ears: it returns no text. */
  transcribe(input: { audio: Uint8Array; language?: Language }): Answer<{ text: string; language?: string }>;
  /**
   * Sona Care: a sentence or two read aloud in Sona's own voice (VoxCPM2 fine-tuned on a Malaysian nurse's voice,
   * docs/tts-training.md), in whichever of Malay, English or Chinese it is written. `audio` is the box's MP3 (or WAV)
   * as base64, ready to send. The stub has no voice: no audio, so the app reads with the phone's voice.
   */
  speak(input: { text: string }): Answer<{ audio?: string }>;
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
  /**
   * Scan a handwritten note: a photo of a ward-round note, drug chart or referral letter as text, the
   * note's sections, medicine changes, tasks and follow-up. Never applied by itself: the doctor reviews
   * every item (scan.apply). `patient` is de-identified by the route before a real model sees it.
   */
  readHandwrittenNote(input: { image: Uint8Array; contentType: string; patient: { name: string; knownMedicines: string[] } }): Answer<HandwrittenNote>;
  /** Sona Care: a photo of a medicine box or letter read as one medicine, for the care team to check. */
  readMedicinePhoto(input: { image?: Uint8Array; contentType?: string }): Answer<{ name: string; dose?: string; frequency?: string }>;
  /**
   * The scribe: a consultation's transcript as the note's four sections, for the doctor to review before saving, and
   * who said what (unsure speakers marked). Every number, dose and medicine in the note is one the transcript has (./scribe-model).
   */
  draftNote(input: { lines: ConsultationLine[] }): Answer<ScribeDraft>;
};

const fixture = <T>(value: T) => Promise.resolve({ ...value, source: "fixture" as const });

/** The authored claim codes, each found by the words that justify it (Amelia's note yields exactly CODES). */
const CODE_RULES: [RegExp, Omit<Code, "evidence">][] = [
  [/pneumonia/i, CODES[0]!], [/asthma/i, CODES[1]!], [/penicillin/i, CODES[2]!], [/chest (film|x-?ray)/i, CODES[3]!],
];

const DESIGN_WORDS: Record<string, string> = { Guideline: "A guideline", Review: "A systematic review", Trial: "A randomised trial", "Narrative review": "A narrative review", Study: "A study", Library: "Your library" };
const MOCK_FOLLOW_UPS = ["What do the guidelines recommend?", "What are the main harms?", "Does this change for severe cases?"];
const firstSentence = (text: string) => text.trim().split(/(?<=[.!?])\s+/)[0] ?? "";

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
  // ponytail: authored appeal rules over the note's own sentences (packages/domain/claim); Gemma replaces it
  // through the Baseten adapter later (docs/delivery-plan.md), with the same shape.
  draftAppeal: input => fixture({ letter: appealByRules(input) }),
  // MOCK, replace with the hosted evidence model: Gemma (box ①) given the question, the thread and the
  // numbered sources returns JSON { claims: { text: string; cites: number[] }[]; followUps: string[] }:
  // 2–4 claims from the sources only, each citing at least one number, strength in words from the design,
  // no dose or number a source lacks, up to 3 follow-ups the sources could answer.
  // Until then: one claim per top source (max 3) quoting its first sentence, and fixed follow-ups.
  synthesiseEvidence: ({ question, sources }) => fixture({
    claims: sources.slice(0, 3).map(s => ({ text: `${DESIGN_WORDS[s.design] ?? "A source"}${s.year ? ` (${s.year})` : ""} reports: ${firstSentence(s.text)}`, cites: [s.n] })),
    followUps: MOCK_FOLLOW_UPS.filter(f => f.toLowerCase() !== question.trim().toLowerCase()),
  }),
  huddleBrief: ({ beds, owners }) => fixture({ lines: huddle(beds, owners) }),
  // ponytail: keyword rule standing in for the classifier; the demo reply is "fever returned".
  classifyReply: ({ text }) => fixture({ label: readReply(text) }),
  transcribe: () => fixture({ text: "" }),
  speak: () => fixture({}),
  // ponytail: keyword rules and templates (packages/domain/messages) until a model triages and drafts.
  triageMessage: ({ text }) => fixture(triageByRules(text)),
  draftReply: input => fixture({ text: draftByRules(input) }),
  // ponytail: full names, IC, phone, email and MRN by rule (packages/domain/training); OpenMed's clinical PII model replaces it, and catches first names too.
  deidentify: ({ text, known }) => fixture(deidentifyByRules(text, known)),
  answerFromPlan: () => fixture({ answer: "", grounded: false, urgent: false }),
  // ponytail: the stub has no eyes; it returns what the sample note says, whatever the photo. Gemma 4 vision
  // or MedGemma replaces it through the Baseten adapter (docs/delivery-plan.md), with the same shape.
  readHandwrittenNote: () => fixture(structuredClone(SAMPLE_NOTE)),
  // ponytail: the sample box's words (a synthetic reading); the same vision model reads real photos.
  readMedicinePhoto: () => fixture({ name: "Cetirizine", dose: "10 mg", frequency: "once at night" }),
  // ponytail: no reader, so the captured words stand as the history and the rest stays the clinician's; Gemma drafts through the Baseten adapter.
  draftNote: ({ lines }) => fixture(ruleNote(lines)),
};
