import { readReply } from "@sona-ai/domain/check-ins";
import { CODES, appealByRules, type AppealLetter, type Code, type DenialCode, type Sentence } from "@sona-ai/domain/claim";
import { draftByRules, triageByRules, type DraftPlan, type MessageLabel } from "@sona-ai/domain/messages";
import { planFor, type Language } from "@sona-ai/domain/discharge";
import type { Mark } from "@sona-ai/domain/answer-parts";
import type { Claim, PatientPoint } from "@sona-ai/domain/evidence";
import type { DetectedFinding } from "@sona-ai/domain/findings";
import { deidentifyByRules, type KnownIdentity, type Replacement } from "@sona-ai/domain/training";
import { SAMPLE_NOTE, type HandwrittenNote } from "@sona-ai/domain/scan";
import type { EnteredRegimen } from "@sona-ai/domain/prescribing";
import type { Patient, SonaOrderCheck } from "@sona-ai/domain/types";
import { huddle, type Bed, type Owner } from "@sona-ai/domain/ward";

import type { Passage } from "./leaflets";
import { ruleNote, type ConsultationLine, type ScribeDraft } from "./scribe-model";

/**
 * The one seam between the routes and the models (docs/delivery-plan.md, Models and hosting: on
 * hold). Routes call `context.models`; turning on Baseten means passing a real `Models` from the
 * Worker's context, nothing else. Every answer says where it came from, so a fixture can never be
 * shown as a model reading, and a model answer carries the model version for provenance. `waking` is on a
 * fixture only while the box that would answer is starting: whole minutes (at least 1) until it should be ready.
 * `storedAt` is on a model's answer only when it was not asked now: the answer it gave then, kept and shown again (./answers).
 */
export type Origin = { source: "fixture"; waking?: number } | { source: "model"; model: string; storedAt?: Date };
/**
 * Which of the two decided a label a model was asked for: the keyword rule's urgent words win over a milder model
 * reading (the safety floor in ./chat-models), and when they did the answer says "rules" beside the model's name, so a
 * rule's label is never shown as the model's. A fixture names none: the rule alone answered.
 */
export type DecidedBy = { decidedBy?: "model" | "rules" };
type Answer<T> = Promise<T & Origin>;
/** One stretch of a part said by one voice. `voice` counts from 1 in order of first speaking; the same person keeps the number across a visit's parts while `memory` is handed back. `from`/`to`: seconds into this part. */
export type VoiceSegment = { voice: number; from: number; to: number; text: string };

/**
 * `from` and `pmid`: a PubMed study's journal and PMID, so the prompt can name them (the stub reads neither).
 * `patient`: asked in a visit, that patient's record as lines of text with no name or record number (the stub reads none).
 */
export type EvidenceInput = { question: string; thread: { question: string; answer: string }[]; sources: { n: number; design: string; year?: number; title: string; text: string; from?: string; pmid?: string }[]; patient?: string };
/**
 * `cutShort`: the model stopped before closing its answer (the length limit), so only the claims it finished are in it.
 * `patientPoints`: what the evidence means for the visit's patient, as written (the route keeps only points whose fact is in the record).
 */
export type EvidenceAnswer = { claims: Claim[]; followUps: string[]; general?: string; bottomLine?: string; cutShort?: boolean; patientPoints?: PatientPoint[] };
/** A part of an evidence answer, as soon as it is written: its bottom line, or one claim. */
export type EvidencePart = { bottomLine: string } | { claim: Claim };

export type VisitSummaryInput = {
  sections: { id: string; text: string }[];
  prescriptions: { name: string; detail?: string; change?: "new" | "changed" | "stopped"; from?: string }[];
  followUps: string[];
};
/** What changed at the visit, one short line each: medicines started, stopped or changed, and new follow-ups. */
export const changesOf = ({ prescriptions, followUps }: VisitSummaryInput) => [
  ...prescriptions.flatMap(p => p.change === "new" ? [`Started ${p.name}`] : p.change === "stopped" ? [`Stopped ${p.name}`]
    : p.change === "changed" ? [`Changed ${p.name}${p.from ? ` (was ${p.from})` : ""}`] : []),
  ...followUps.map(f => `Follow-up: ${f}`),
];

export type Models = {
  /** Brain (Gemma): what to know before seeing the patient. */
  /**
   * `visitPrep` is what the patient shared from Sona Care before the visit (visitPrepBlock), when they shared anything.
   * `record` is the record's lines as of now (recordFacts: the latest dated reading of each observation, the latest
   * results); without it the brief reads the patient's intake fields, vitals as written at intake.
   */
  briefing(input: { patient: Patient; visitPrep?: string; record?: string[] }): Answer<{ lines: string[] }>;
  /** `withheld` (on a fixture): the model did answer, and nothing in its reply passed the checks (cited, no number the record lacks). */
  reasoning(input: { patient: Patient; question: string }): Answer<{ answer: string; sourceIds: string[]; withheld?: boolean }>;
  /** X-ray box: never a validated read in this demo. */
  xrayRead(input: { image: Uint8Array; contentType: string }): Answer<{ findings: string[]; validated: false }>;
  /** Demo flow 6: findings beyond the question asked, each with a box on the image (a real model's reply goes through `readBoxes`). Never validated. */
  incidentalFindings(input: { patientId: string; image?: Uint8Array; contentType?: string }): Answer<{ findings: DetectedFinding[]; validated: false }>;
  /** `summary` is the full text; `lines` the three-line summary when a model wrote it (the app shows the plan's own lines otherwise). */
  draftDischarge(input: { patient: Patient; language: Language }): Answer<{ summary: string; leaflet: string; lines?: { diagnosis: string; course: string; plan: string } }>;
  /** After-visit summary in plain words for the patient, from the saved note; `whatChanged` is always rule-built (changesOf). A clinician approves it before the patient reads it. */
  draftVisitSummary(input: VisitSummaryInput): Answer<{ text: string; whatChanged: string[] }>;
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
  /**
   * `bottomLine`: one sentence answering the question, from the claims. Each claim may carry its `topic` and, per cited
   * source, the sentence that supports it (`quotes`; the route keeps only those the source says word for word).
   * `general`: the model's own answer from general knowledge, when no source answers the question.
   */
  synthesiseEvidence(input: EvidenceInput): Answer<EvidenceAnswer>;
  /**
   * Optional: the same answer as it is written, part by part (its bottom line, then each claim as it closes), ending
   * with the whole of it as `synthesiseEvidence` gives it. Without it, the answer arrives whole.
   */
  streamEvidence?(input: EvidenceInput): AsyncGenerator<EvidencePart, Awaited<Answer<EvidenceAnswer>>>;
  huddleBrief(input: { beds: Bed[]; owners: Record<string, Owner | undefined> }): Answer<{ lines: string[] }>;
  /** Sona Care: the patient's speech as text (Malay, English, Chinese or mixed). The stub has no ears: it returns no text.
   * With `voices` the speech box also says who spoke when: the part as voice-numbered segments, and its memory of the voices to hand back with the visit's next part. */
  transcribe(input: { audio: Uint8Array; language?: Language; voices?: { memory?: string } }):
    Answer<{ text: string; language?: string; segments?: VoiceSegment[]; memory?: string }>;
  /**
   * Sona Care: a sentence or two read aloud in Sona's own voice (VoxCPM2 fine-tuned on a Malaysian nurse's voice,
   * docs/tts-training.md), in whichever of Malay, English or Chinese it is written. `audio` is the box's MP3 (or WAV)
   * as base64, ready to send. The stub has no voice: no audio, so the app reads with the phone's voice.
   */
  speak(input: { text: string }): Answer<{ audio?: string }>;
  /**
   * Sona Care: an answer to any question the patient asks; their own care from their record (`plan`: recordText, the
   * discharge plan and what the hospital recorded about them). `grounded` false means the answer is general knowledge,
   * not their record (the app marks it so); `from` names the part of the record; `urgent` puts the 999 line first.
   * The stub answers nothing, so the app's authored plan answers stay in charge.
   * `passages`: the hospital's patient leaflets found for the question (./leaflets), which general advice rests on when
   * one fits; `cites` the numbers of those the answer used, as the model wrote them (care.ask keeps only numbers offered).
   * `history`: the chat's earlier turns, oldest first, so a follow-up ("How does it help?") is read in their light.
   */
  answerFromPlan(input: { question: string; plan: string; language: Language; passages?: Passage[]; history?: { question: string; answer: string }[] }): Answer<{ answer: string; grounded: boolean; urgent: boolean; from?: string; cites?: number[]; /** The words to colour, the model's choice (chat-models MARKS_RULE). */ marks?: Mark[] }>;
  /**
   * Sona Care: what one of the patient's own lab results means, in plain words in their language. Only asked for a
   * result a doctor has acknowledged (care.results.explain). What such a value commonly means, in general terms, is fine.
   * The stub says only what was measured and to ask the care team.
   */
  explainResult(input: { test: string; value: string; unit?: string; flag?: string; language: Language }): Answer<{ text: string }>;
  /** After-discharge check-ins: worse or urgent replies become a flagged task (with the model's short symptom, when it read one). */
  classifyReply(input: { text: string; language: Language }): Answer<{ label: "fine" | "worse" | "urgent"; symptom?: string } & DecidedBy>;
  /** The care team's inbox: how soon a patient message needs a clinician (urgent, clinical, admin) and why, in a few words. */
  triageMessage(input: { text: string; language?: Language }): Answer<{ label: MessageLabel; reason: string } & DecidedBy>;
  /**
   * The inbox's suggested reply to a patient message, for a person to check before sending: short and kind,
   * in the patient's language, answering what they asked; their own medicines and next visit as their plan states them.
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
  /**
   * One page of a scanned document or a photographed leaflet, transcribed word for word for the library; "" when it holds
   * no text. `unsure` holds the words the model nearly read differently, for staff to check against the page.
   */
  readDocumentPage(input: { image: Uint8Array; contentType: string }): Answer<{ text: string; unsure: string[] }>;
  /** Sona Care: a photo of a medicine box or letter read as one medicine, for the care team to check. */
  readMedicinePhoto(input: { image?: Uint8Array; contentType?: string }): Answer<{ name: string; dose?: string; frequency?: string }>;
  /**
   * The scribe: a consultation's transcript as the note's four sections, for the doctor to review before saving, and
   * who said what (unsure speakers marked). Every number, dose and medicine in the note is one the transcript has (./scribe-model).
   */
  draftNote(input: { lines: ConsultationLine[] }): Answer<ScribeDraft>;
  /**
   * Checks an order no dose rule covers against the patient's record (dose and frequency, allergies, interactions with
   * `medicines`, kidney and liver function): a verdict per area with its reason. No items when it could not judge.
   */
  checkOrder(input: { regimen: EnteredRegimen; patient: Patient; medicines: string[]; weightKg?: string }): Answer<{ items: SonaOrderCheck["items"] }>;
};

const RESULT_LINE: Record<Language, (result: string) => string> = {
  en: r => `Your result was ${r}. Your care team has seen it; ask them what it means for you.`,
  ms: r => `Keputusan anda ialah ${r}. Pasukan penjagaan anda telah melihatnya; tanya mereka apa maksudnya untuk anda.`,
  zh: r => `您的结果是 ${r}。您的医护团队已经看过；请向他们了解这对您意味着什么。`,
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
  briefing: ({ patient, visitPrep }) => fixture({ lines: [
    patient.complaint,
    patient.allergies ? `Allergy recorded: ${patient.allergies.split(" — ")[0]}.` : "No allergy recorded; confirm before prescribing.",
    ...(patient.incomplete ? ["History is incomplete: onset, observations, allergies and medicines are still missing."] : []),
    ...(visitPrep?.split("\n") ?? []),
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
  // The note's own sentences, then what changed: nothing is reworded, so every sentence has its source.
  draftVisitSummary: input => { const whatChanged = changesOf(input); return fixture({ whatChanged,
    text: [...input.sections.map(s => s.text.trim()).filter(Boolean), ...whatChanged].map(t => /[.!?]$/.test(t) ? t : `${t}.`).join(" ") }); },
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
    claims: sources.slice(0, 3).map(s => ({ text: `${DESIGN_WORDS[s.design] ?? "A source"}${s.year ? ` (${s.year})` : ""} reports: ${firstSentence(s.text)}`, cites: [s.n], topic: "evidence" as const, quotes: [{ n: s.n, text: firstSentence(s.text) }] })),
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
  // ponytail: full names, IC, phone, email and MRN by rule (packages/domain/training); on Baseten OpenMed's PII model adds first names and other people (./pii-model).
  deidentify: ({ text, known }) => fixture(deidentifyByRules(text, known)),
  answerFromPlan: () => fixture({ answer: "", grounded: false, urgent: false }),
  // ponytail: a template naming the result, until a model explains it.
  explainResult: ({ test, value, unit, language }) => fixture({ text: RESULT_LINE[language](`${test} ${value}${unit ? ` ${unit}` : ""}`) }),
  // ponytail: the stub has no eyes; it returns what the sample note says, whatever the photo. MedGemma reads
  // photos through the Baseten adapter (./vision-models), with the same shape.
  readHandwrittenNote: () => fixture(structuredClone(SAMPLE_NOTE)),
  // Nothing is read without the model: the library route refuses the scan rather than store an empty page.
  readDocumentPage: () => fixture({ text: "", unsure: [] }),
  // ponytail: the sample box's words (a synthetic reading); the same vision model reads real photos.
  readMedicinePhoto: () => fixture({ name: "Cetirizine", dose: "10 mg", frequency: "once at night" }),
  // ponytail: no reader, so the captured words stand as the history and the rest stays the clinician's; Gemma drafts through the Baseten adapter.
  draftNote: ({ lines }) => fixture(ruleNote(lines)),
  // No model to judge the order: no verdicts, so the card warns the doctor to check it themselves.
  checkOrder: () => fixture({ items: [] }),
};
