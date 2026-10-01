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

/**
 * The rule for a detected finding: a nodule by its size (bands are to 0.1 mm), anything else by its kind. A nodule
 * nobody sized has no rule: the size table cannot place it, and "under 6 mm" would wrongly say no follow-up.
 */
export function ruleFor(finding: DetectedFinding, rules: FollowUpRule[]): FollowUpRule | undefined {
  if (finding.kind !== "nodule") return rules.find(r => r.kind === finding.kind);
  if (finding.sizeMm == null) return undefined;
  const mm = Math.round(finding.sizeMm * 10) / 10;
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
 * Where each kind can sit on a frontal film, as [min, max] of the box's width, height and centre (0 to 1):
 * a nodule is small and in a lung, a heart box is wide and central, an effusion sits low. A box outside
 * these is a misplaced mark, not a finding. ponytail: fixed adult PA proportions; a child's film or a
 * lateral view needs its own, and a real localiser replaces the check once marks are validated.
 */
const FITS: Record<FindingKind, { w: [number, number]; h: [number, number]; x: [number, number]; y: [number, number] }> = {
  nodule: { w: [0.01, 0.15], h: [0.01, 0.15], x: [0.05, 0.95], y: [0.05, 0.9] },
  cardiomegaly: { w: [0.2, 0.75], h: [0.15, 0.6], x: [0.35, 0.75], y: [0.4, 0.85] },
  effusion: { w: [0.08, 0.6], h: [0.05, 0.75], x: [0.05, 0.95], y: [0.4, 0.95] },
};
const within = (n: number, [min, max]: [number, number]) => n >= min && n <= max;
/** The zone words in a label ("left", "lower"...) agree with where the box is; a label naming none says nothing to contradict. */
function zoneAgrees(label: string, zone: string) {
  const said = label.toLowerCase();
  const side = /\bleft\b/.test(said) ? "left" : /\bright\b/.test(said) ? "right" : undefined;
  const level = /\b(upper|apex|apical)\b/.test(said) ? "upper" : /\b(middle|mid)\b/.test(said) ? "middle" : /\b(lower|base|basal)\b/.test(said) ? "lower" : undefined;
  return (!side || zone.startsWith(side)) && (!level || zone.includes(level));
}

/**
 * Reads a localisation answer ({ label, box_2d }[] as JSON, possibly fenced) into findings. `scale` is
 * what the coordinates are out of (MedGemma 1.5 answers in thousandths, 1000). Only kinds with a
 * follow-up rule are kept, and a box that is inside out, off the image, the wrong size or shape for its
 * kind, or somewhere its label's zone words contradict is dropped rather than repaired: a wrong mark on
 * a film is worse than none. Size comes only from the label.
 */
export function readBoxes(reply: string, scale = 1): DetectedFinding[] {
  let rows: unknown;
  try { rows = JSON.parse(reply.slice(reply.indexOf("["), reply.lastIndexOf("]") + 1)); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: { label?: unknown; box_2d?: unknown }): DetectedFinding[] => {
    const box = row.box_2d, label = typeof row.label === "string" ? row.label.trim() : "";
    const kind = KINDS.find(([re]) => re.test(label))?.[1];
    if (!kind || !Array.isArray(box) || box.length !== 4 || !box.every(n => typeof n === "number" && n >= 0 && n <= scale)) return [];
    const [y0, x0, y1, x1] = box.map(n => round(n / scale)) as Box;
    if (y1 <= y0 || x1 <= x0) return [];
    const x = round((x0 + x1) / 2), y = round((y0 + y1) / 2), mm = label.match(/(\d+(?:\.\d+)?)\s*mm/i);
    // Effusions on both sides are one box across the chest.
    const fits = kind === "effusion" && /\b(both|bilateral)\b/i.test(label) ? { ...FITS.effusion, w: [0.3, 0.95] as [number, number] } : FITS[kind], zone = zoneOf(kind, x, y);
    if (!within(x1 - x0, fits.w) || !within(y1 - y0, fits.h) || !within(x, fits.x) || !within(y, fits.y) || (kind !== "cardiomegaly" && !zoneAgrees(label, zone))) return [];
    return [{ kind, label, ...(mm ? { sizeMm: Number(mm[1]) } : {}), location: { x, y, zone, box: [y0, x0, y1, x1] } }];
  });
}
