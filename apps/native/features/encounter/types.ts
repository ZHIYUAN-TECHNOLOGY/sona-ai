export type Capability = "briefing" | "reasoning" | "xray" | "medication" | "prescription" | "followup" | "note";
export type FocusView = "recording" | "note" | "xray" | "tasks";
export type Source = { id: string; title: string; date: string; kind: "record" | "transcript" | "image" | "reference"; excerpt: string; synthetic: boolean; url?: string };
export type Patient = {
  id: string; encounterId: string; name: string; initials: string; age: number; sex: string;
  subtitle: string; time: string; complaint: string; history: string[]; family: string; social: string;
  allergies: string | null; medicines: string[]; vitals: { label: string; value: string }[];
  sources: Source[]; incomplete: boolean;
};
export type TranscriptLine = { id: string; speaker: string; original: string; english: string; corrected?: boolean; englishReviewed?: boolean };
export type HistoryFact = { id: string; category: "medical" | "family" | "social" | "allergy" | "presenting"; value: string; source: string; date: string; revision: number };
export type MedicationEntry = { id: string; name: string; ingredient: string; formulation: string; confirmed: boolean };
export type PrescriptionInputs = { weightKg: string; liverDisease: "unknown" | "no" | "yes"; kidneyDisease: "unknown" | "no" | "yes"; alcoholRisk: "unknown" | "no" | "yes"; paracetamolAllergy: "unknown" | "no" | "yes" };
export type PrescriptionCheck = { id: string; label: string; status: "passed" | "blocked"; detail: string };
export type Regimen = { medication: string; formulation: string; dose: string; unit: string; route: string; frequency: string; duration: string; indication: string; sourceId: string; sourceVersion: string };
export type NoteSections = { subjective: string; objective: string; assessment: string; plan: string };
export type Task = { id: string; title: string; owner: string; due: string; completed: boolean; sourceSnapshot?: Source; sourceId?: string; sourceRevision?: number; provenance?: "fixture" | "clinician" };
export type Prescription = { id: string; revision: number; status: "blocked" | "created" | "failed"; reasons: string[]; createdAt: string; regimen?: Regimen; checks?: PrescriptionCheck[]; audit?: string[]; supersedes?: string; inputs?: PrescriptionInputs };
export type ResponseCard = { id: string; kind: Capability; requestId: string; patientId: string; encounterId: string; revision: number; prescription?: Prescription; imagingSnapshot?: { imagingAttachment?: { uri: string; name: string }; hideTeachingImage?: boolean; imagingScenario?: "reference" | "unsupported" | "no-finding" }; patientSnapshot?: Patient; transcriptSnapshot?: TranscriptLine[]; sections?: number };
export type RequestState = { id: string; kind: Capability; prompt: string; patientId: string; encounterId: string; revision: number; status: "streaming" | "complete" | "failed" | "cancelled"; error?: string };
export type Encounter = {
  revision: number; historyFacts?: HistoryFact[]; historyDraft?: Omit<HistoryFact, "id" | "revision">;
  medicationEntries?: MedicationEntry[]; medicationDraft?: MedicationEntry; proposedMedicine?: string; proposedMedicineDraft?: string;
  prescriptionInputs?: PrescriptionInputs; prescriptionInputsOpen?: number;
  /** A review or simulation running in place inside the prescribe card (no new answer). */
  working?: "medication" | "prescription";
  /** A review existed but a later edit invalidated it (so the card can say "rerun", not "run"). */
  reviewInvalidated?: boolean; prescriptionScenario?: "standard" | "unknown-coverage" | "unsupported" | "failed-prerequisite" | "creation-failure"; prescriptionAmendment?: string;
  amendmentOperation?: { id: string; revision: number; phase: "queued-review" | "reviewing" | "queued-issue" | "issuing" | "complete" | "failed" | "cancelled"; requestId?: string; error?: string };
  noteSections?: NoteSections; noteSectionDraft?: NoteSections; noteSaveStatus?: "idle" | "saving" | "saved" | "failed";
  imagingScenario?: "reference" | "unsupported" | "no-finding";
  cards: ResponseCard[]; requests: RequestState[]; note: string; noteReviewed: boolean;
  transcript: TranscriptLine[]; recording: "idle" | "recording" | "paused" | "stopped";
  transcriptDraft?: { lineId: string; speaker: string; original: string; english?: string };
  recordingSeconds: number; language: "english" | "manglish"; tasks: Task[];
  taskDraft?: { operationId: string; title: string; owner: string; due: string; sourceSnapshot?: Source; sourceId?: string; sourceRevision?: number; provenance?: "fixture" | "clinician" };
  taskEditDraft?: { operationId: string; title: string; owner: string; due: string; sourceSnapshot?: Source; sourceId?: string; sourceRevision?: number; provenance?: "fixture" | "clinician" };
  imagingAttachment?: { uri: string; name: string };
  hideTeachingImage?: boolean;
  prescription?: Prescription; medicationCheckedRevision?: number;
  discharge?: import("@/features/discharge/model").DischargeState;
  claim?: import("@/features/claim/model").ClaimState;
};
export type FeatureProps = { patient: Patient; result?: ResponseCard; onSource: (id: string) => void; onOpen: (view: FocusView) => void; onRequest: (kind: Capability) => void };
