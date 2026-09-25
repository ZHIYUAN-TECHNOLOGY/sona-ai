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
