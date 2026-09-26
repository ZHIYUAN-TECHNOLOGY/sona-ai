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
/** Open until a doctor tracks it (a task and a recall) or dismisses it with a reason. */
export type FindingStatus = "open" | "tracked" | "dismissed";

/** The rule for a detected finding: a nodule by its size (bands are to 0.1 mm), anything else by its kind. */
export function ruleFor(finding: DetectedFinding, rules: FollowUpRule[]): FollowUpRule | undefined {
  if (finding.kind !== "nodule") return rules.find(r => r.kind === finding.kind);
  const mm = Math.round((finding.sizeMm ?? 0) * 10) / 10;
  return rules.find(r => r.kind === "nodule" && (r.minMm ?? 0) <= mm && mm <= (r.maxMm ?? Infinity));
}

/** When the follow-up falls due, counted from when the finding was seen; none without an interval. */
export const dueDate = (rule: Pick<FollowUpRule, "intervalDays">, from: Date) =>
  rule.intervalDays == null ? undefined : new Date(from.getTime() + rule.intervalDays * 86400_000);

/** A tracked follow-up whose date has passed; an open finding is a blocker instead. */
export const isOverdue = (f: { status: FindingStatus; dueAt?: Date | string | null }, at: Date) =>
  f.status === "tracked" && Boolean(f.dueAt) && new Date(f.dueAt!).getTime() < at.getTime();

type Line = { label: string; action: string | null; dueAt?: Date | string | null };
/** "25 Dec", in the demo hospital's time (Malaysia) whatever the device or Worker clock says. */
export const shortDate = (at: Date | string) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" });
const due = (f: Line) => (f.dueAt ? ` · due ${shortDate(f.dueAt)}` : "");

/** The rule's action and due date, as the finding card shows it. */
export const followUpLine = (f: Line) => `${f.action ?? "No follow-up rule"}${due(f)}`;

/** One line for handover and discharge: "Follow up 9 mm nodule: CT chest at 3 months · due 25 Dec". */
export function findingLine(f: Line) {
  const what = f.label.split(",")[0]!, action = (f.action ?? "No follow-up rule").split(",")[0];
  return `Follow up ${what.charAt(0).toLowerCase()}${what.slice(1)}: ${action}${due(f)}`;
}
