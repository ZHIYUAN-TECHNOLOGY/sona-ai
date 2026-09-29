import { z } from "zod";

/**
 * Shared payload contracts between the app, the Worker and the Agent. Every lane builds against
 * these; clinical values travel with a source ID, never as free text from a model.
 */
export const icdCodeSchema = z.object({ code: z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/), label: z.string().min(1) });
export type IcdCode = z.infer<typeof icdCodeSchema>;

/** Retrieval is always scoped to the caller's hospital (row-level security enforces it underneath). */
export const searchInputSchema = z.object({ query: z.string().trim().min(1).max(500), hospitalId: z.string().min(1), k: z.number().int().min(1).max(20).default(5) });
export type SearchInput = z.infer<typeof searchInputSchema>;

/** A consequential action (discharge, sending a claim): replay-safe by requestId, and never without an approver. */
export const approvedCommandSchema = z.object({ encounterId: z.string().min(1), requestId: z.string().min(1), approvedBy: z.string().min(1) });
export type ApprovedCommand = z.infer<typeof approvedCommandSchema>;

/** Drug data is a bounded, cited table: a dose always carries its source, anything else is "not covered". */
export const drugLookupSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("covered"), drug: z.string().min(1), dose: z.string().min(1), sourceId: z.string().min(1) }),
  z.object({ status: z.literal("not-covered"), drug: z.string().min(1) }),
]);
export type DrugLookup = z.infer<typeof drugLookupSchema>;

export const retrievalHitSchema = z.object({
  chunkId: z.string().min(1), documentId: z.string().min(1), sourceId: z.string().min(1), text: z.string(), score: z.number(),
  tags: z.object({ source: z.string().min(1), year: z.number().int(), section: z.string().min(1) }),
});
export type RetrievalHit = z.infer<typeof retrievalHitSchema>;

export const OWNERS = ["Pharmacy", "Billing", "Porter", "Nurse"] as const;
export const assignOwnerSchema = z.object({ blockerId: z.string().min(1), owner: z.enum(OWNERS) });
export type AssignOwner = z.infer<typeof assignOwnerSchema>;

/** Chart values used by calculators such as CURB-65; each reading keeps its source. */
export const observationSchema = z.object({
  patientId: z.string().min(1), kind: z.enum(["confusion", "urea", "respiratory-rate", "systolic", "diastolic"]),
  value: z.number(), unit: z.string(), sourceId: z.string().min(1),
});
export type Observation = z.infer<typeof observationSchema>;

/** The discharge card's inline fixes: take-home medicines, follow-up, leaflet language. */
export const dischargeUpdateSchema = z.object({
  encounterId: z.string().min(1), medsConfirmed: z.boolean().optional(),
  followUp: z.enum(["1w", "2w", "4w"]).optional(), language: z.enum(["ms", "en", "zh"]).optional(),
});
export type DischargeUpdate = z.infer<typeof dischargeUpdateSchema>;

/** The guarantee letter's inline fixes, each adding its sentence to the note. */
export const claimUpdateSchema = z.object({ encounterId: z.string().min(1), organismConfirmed: z.boolean().optional(), ivReasonAdded: z.boolean().optional() });
export type ClaimUpdate = z.infer<typeof claimUpdateSchema>;

/** The doctor's appeal against a denied guarantee letter, as they edited it; each point cites a note sentence by id. */
export const appealSchema = approvedCommandSchema.extend({
  letter: z.object({
    opening: z.string().trim().min(1).max(2000),
    points: z.array(z.object({ claim: z.string().trim().min(1).max(1000), evidenceSentenceId: z.string().min(1) })).min(1).max(12),
    closing: z.string().trim().min(1).max(2000),
  }),
});

const unknownYesNo = z.enum(["unknown", "no", "yes"]);
/** A patient history fact as the app records it (HistoryFact in the domain types). */
export const historyFactSchema = z.object({
  id: z.string().min(1), category: z.enum(["medical", "family", "social", "allergy", "presenting"]),
  value: z.string().trim().min(1), source: z.string(), date: z.string(), revision: z.number().int().nonnegative(),
});
/**
 * Edits that change prescribing eligibility, the medicine list or the history; they bump the revision
 * and invalidate the review. A new history fact (an allergy, liver disease) can change eligibility, so
 * after a history edit the review must be rerun too.
 */
export const encounterEditSchema = z.object({
  encounterId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  prescriptionInputs: z.object({ weightKg: z.string(), liverDisease: unknownYesNo, kidneyDisease: unknownYesNo, alcoholRisk: unknownYesNo, paracetamolAllergy: unknownYesNo }).optional(),
  medicationEntries: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), ingredient: z.string(), formulation: z.string(), confirmed: z.boolean(), change: z.enum(["new", "changed", "stopped"]).optional(), from: z.string().optional() })).optional(),
  proposedMedicine: z.string().optional(),
  historyFacts: z.array(historyFactSchema).optional(),
}).refine(e => e.prescriptionInputs || e.medicationEntries || e.proposedMedicine !== undefined || e.historyFacts, "An edit changes eligibility, medicines or history");
export type EncounterEdit = z.infer<typeof encounterEditSchema>;

/** A medication review ran against this revision; it stays current until the next eligibility or medicine edit. */
export const recordReviewSchema = z.object({ encounterId: z.string().min(1), expectedRevision: z.number().int().positive() });
export type RecordReview = z.infer<typeof recordReviewSchema>;

// lane P
/** A note is its sentences with stable IDs; a save appends the next revision after the one the caller last saw (0 before any). */
export const noteSaveSchema = z.object({
  encounterId: z.string().min(1), expectedRevision: z.number().int().min(0),
  sentences: z.array(z.object({ id: z.string().min(1), text: z.string() })),
  /** The doctor keeps this visit's note out of the de-identified training samples. */
  excludeFromTraining: z.boolean().optional(),
});
export type NoteSave = z.infer<typeof noteSaveSchema>;
// lane H
/** "Hold to accept handover": the receiving clinician takes these cards; replay-safe by requestId. */
export const handoverAcceptSchema = z.object({ requestId: z.string().min(1), cardIds: z.array(z.string().min(1)).min(1), toUser: z.string().trim().min(1) });
export type HandoverAccept = z.infer<typeof handoverAcceptSchema>;
/** An X-ray for an encounter as base64 (about 10 MB of image at most); only image types are stored. */
export const xrayUploadSchema = z.object({
  encounterId: z.string().min(1), contentType: z.string().regex(/^image\/[a-z0-9.+-]+$/i, "Only images can be uploaded"), dataBase64: z.string().min(1).max(14_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, "Not base64"),
});
export type XrayUpload = z.infer<typeof xrayUploadSchema>;
/** A photo of a handwritten note, same shape as an X-ray upload. */
export const scanUploadSchema = xrayUploadSchema;
/** The sample note bundled with the app: read by the fixture, never uploaded. */
export const SAMPLE_SCAN_KEY = "sample";
/** Sona Care's bundled sample medicine box: sent as a photo message's key, never uploaded (both apps bundle the image). */
export const SAMPLE_PHOTO_KEY = "sample-medicine";
const text = z.string().trim().max(4000);
/** What the doctor kept from a scanned note after review; only these are written. Replay-safe by requestId. */
export const scanApplySchema = z.object({
  encounterId: z.string().min(1), key: z.string().min(1), requestId: z.string().min(1),
  sections: z.object({ history: text, examination: text, assessment: text, plan: text }).partial().optional(),
  medicines: z.array(z.object({
    name: z.string().trim().min(1).max(120), dose: z.string().trim().max(80).optional(), frequency: z.string().trim().max(80).optional(),
    change: z.enum(["new", "changed", "stopped", "continue"]), confidence: z.enum(["high", "low"]),
  })).max(20).optional(),
  tasks: z.array(z.object({ title: z.string().trim().min(1).max(200), due: z.string().trim().max(40).optional(), owner: z.string().trim().max(60).optional() })).max(20).optional(),
  followUp: z.object({ in: z.string().trim().min(1).max(40) }).optional(),
});
export type ScanApply = z.infer<typeof scanApplySchema>;
// Demo flow 6
/** Turning a finding into a tracked follow-up (a task and a recall); replay-safe by requestId. */
export const findingTrackSchema = z.object({ findingId: z.string().min(1), requestId: z.string().min(1), owner: z.string().trim().min(1).optional() });
export type FindingTrack = z.infer<typeof findingTrackSchema>;
/** Dismissing a finding keeps it, with who dismissed it and why, so the decision is on record. */
export const findingDismissSchema = z.object({ findingId: z.string().min(1), reason: z.string().trim().min(1).max(500) });
export type FindingDismiss = z.infer<typeof findingDismissSchema>;
// Demo flow 7
/** A patient's reply in the simulated inbox (no real messaging in the demo). */
export const checkInReplySchema = z.object({ checkInId: z.string().min(1), text: z.string().trim().min(1).max(1000) });
export type CheckInReply = z.infer<typeof checkInReplySchema>;
// lane T2
/** A follow-up a doctor writes for a visit; replay-safe by requestId. */
export const taskCreateSchema = z.object({
  encounterId: z.string().min(1), title: z.string().trim().min(1).max(200), owner: z.string().trim().min(1).max(80), due: z.iso.date().optional(), requestId: z.string().min(1),
});
export type TaskCreate = z.infer<typeof taskCreateSchema>;
