/**
 * Demo flow 6, incidental finding tracker (docs/research/ops-demo-flows.md). A finding is
 * something on an image beyond the question asked; it is never validated in this demo, and its
 * follow-up interval comes from the rules table, never from the model.
 */
export type FindingKind = "nodule" | "cardiomegaly" | "effusion";
export type RiskBand = "low" | "intermediate" | "high";
/** Where on the image, normalised 0 to 1 from the top left, with the zone a report would name. */
export type FindingLocation = { x: number; y: number; zone: string };
/** What the image reader returns for one finding, before a rule is applied. */
export type DetectedFinding = { kind: FindingKind; label: string; sizeMm?: number; location: FindingLocation };
export type FollowUpRule = { id: string; kind: FindingKind; riskBand: RiskBand; minMm: number | null; maxMm: number | null; intervalDays: number | null; action: string; source: string };
