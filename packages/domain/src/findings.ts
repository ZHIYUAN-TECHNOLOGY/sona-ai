/**
 * Demo flow 6, incidental finding tracker (docs/research/ops-demo-flows.md). A finding is
 * something on an image beyond the question asked; it is never validated in this demo, and its
 * follow-up interval comes from the rules table, never from the model.
 */
export type FindingKind = "nodule" | "cardiomegaly" | "effusion";
export type RiskBand = "low" | "intermediate" | "high";
/** Where on the image, normalised 0 to 1 from the top left, with the zone a report would name. */
export type FindingLocation = { x: number; y: number; zone: string; box?: Box };
/** A region as MedGemma 1.5 returns it: [y0, x0, y1, x1], normalised 0 to 1 from the top left. */
export type Box = [number, number, number, number];
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

const KINDS: [RegExp, FindingKind][] = [[/nodule|mass/i, "nodule"], [/cardiomegaly|heart size|enlarged heart/i, "cardiomegaly"], [/effusion/i, "effusion"]];
const round = (n: number) => Math.round(n * 1000) / 1000;
/** The zone a report would name. On a frontal film the image's right half is the patient's left. */
function zoneOf(kind: FindingKind, x: number, y: number) {
  if (kind === "cardiomegaly") return "cardiac silhouette";
  return `${x < 0.5 ? "right" : "left"} ${y < 1 / 3 ? "upper" : y < 2 / 3 ? "middle" : "lower"} zone`;
}

/**
 * Reads a localisation answer ({ label, box_2d }[] as JSON, possibly fenced) into findings. Only
 * kinds with a follow-up rule are kept, and a box that is inside out or off the image is dropped
 * rather than repaired: a wrong mark on a film is worse than none. Size comes only from the label.
 */
export function readBoxes(reply: string): DetectedFinding[] {
  let rows: unknown;
  try { rows = JSON.parse(reply.slice(reply.indexOf("["), reply.lastIndexOf("]") + 1)); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: { label?: unknown; box_2d?: unknown }): DetectedFinding[] => {
    const box = row.box_2d, label = typeof row.label === "string" ? row.label.trim() : "";
    const kind = KINDS.find(([re]) => re.test(label))?.[1];
    if (!kind || !Array.isArray(box) || box.length !== 4 || !box.every(n => typeof n === "number" && n >= 0 && n <= 1)) return [];
    const [y0, x0, y1, x1] = box as Box;
    if (y1 <= y0 || x1 <= x0) return [];
    const x = round((x0 + x1) / 2), y = round((y0 + y1) / 2), mm = label.match(/(\d+(?:\.\d+)?)\s*mm/i);
    return [{ kind, label, ...(mm ? { sizeMm: Number(mm[1]) } : {}), location: { x, y, zone: zoneOf(kind, x, y), box: [y0, x0, y1, x1] } }];
  });
}
