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

const unknownYesNo = z.enum(["unknown", "no", "yes"]);
/** Edits that change prescribing eligibility or the medicine list; they bump the revision and invalidate the review. */
export const encounterEditSchema = z.object({
  encounterId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  prescriptionInputs: z.object({ weightKg: z.string(), liverDisease: unknownYesNo, kidneyDisease: unknownYesNo, alcoholRisk: unknownYesNo, paracetamolAllergy: unknownYesNo }).optional(),
  medicationEntries: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), ingredient: z.string(), formulation: z.string(), confirmed: z.boolean() })).optional(),
  proposedMedicine: z.string().optional(),
}).refine(e => e.prescriptionInputs || e.medicationEntries || e.proposedMedicine !== undefined, "An edit changes eligibility or medicines");
export type EncounterEdit = z.infer<typeof encounterEditSchema>;

/** A medication review ran against this revision; it stays current until the next eligibility or medicine edit. */
export const recordReviewSchema = z.object({ encounterId: z.string().min(1), expectedRevision: z.number().int().positive() });
export type RecordReview = z.infer<typeof recordReviewSchema>;

// lane P
/** A note is its sentences with stable IDs; a save appends the next revision after the one the caller last saw (0 before any). */
export const noteSaveSchema = z.object({
  encounterId: z.string().min(1), expectedRevision: z.number().int().min(0),
  sentences: z.array(z.object({ id: z.string().min(1), text: z.string() })),
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
