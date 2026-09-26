import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { dueDate, findingLine, isOverdue, ruleFor, type DetectedFinding, type FollowUpRule } from "@sona-ai/domain/findings";
import type { DayItem } from "@/features/day/model";
import type { Task } from "@/features/encounter/types";
import { localDate } from "@/features/tasks/state";

/**
 * Demo flow 6, incidental findings: the rules live in @sona-ai/domain/findings (the server applies
 * the same ones). Fixture mode builds Amelia's two findings in the server's row shape, so every
 * screen renders one type whichever mode is on.
 */
export * from "@sona-ai/domain/findings";
export type Finding = Awaited<ReturnType<AppRouterClient["findings"]["list"]>>[number];

// Mirrors data/follow-up-rules.csv, the table the server is seeded from.
const source = "synthetic demo table";
const RULES: FollowUpRule[] = [
  { id: "nodule-under-6", kind: "nodule", riskBand: "low", minMm: 0, maxMm: 5.9, intervalDays: null, action: "No routine follow-up", source },
  { id: "nodule-6-to-8", kind: "nodule", riskBand: "intermediate", minMm: 6, maxMm: 8, intervalDays: 180, action: "CT chest at 6 to 12 months", source },
  { id: "nodule-over-8", kind: "nodule", riskBand: "high", minMm: 8.1, maxMm: 100, intervalDays: 90, action: "CT chest at 3 months, PET-CT or tissue sampling", source },
  { id: "cardiomegaly-borderline", kind: "cardiomegaly", riskBand: "intermediate", minMm: null, maxMm: null, intervalDays: 42, action: "Echocardiogram", source },
  { id: "effusion-small", kind: "effusion", riskBand: "intermediate", minMm: null, maxMm: null, intervalDays: 14, action: "Repeat chest X-ray or ultrasound", source },
];
// Mirrors the model seam's stub (packages/api/src/models.ts): Amelia's authored findings.
const DETECTED: DetectedFinding[] = [
  { kind: "nodule", label: "9 mm nodule, right upper zone", sizeMm: 9, location: { x: 0.34, y: 0.3, zone: "right upper zone" } },
  { kind: "cardiomegaly", label: "Borderline heart size", location: { x: 0.56, y: 0.62, zone: "cardiac silhouette" } },
];

/** Amelia's findings as the server would list them after detection at `seenAt`. */
export function fixtureFindings(seenAt: Date): Finding[] {
  return DETECTED.map(f => {
    const rule = ruleFor(f, RULES);
    return {
      id: `finding:visit-1042:${f.kind}`, hospitalId: "demo", patientId: "SYN-1042", patientName: "Amelia Tan", encounterId: "visit-1042", imageKey: null,
      kind: f.kind, label: f.label, sizeMm: f.sizeMm ?? null, location: f.location, riskBand: rule?.riskBand ?? "intermediate", ruleId: rule?.id ?? null,
      status: "open", source: "fixture", taskId: null, dueAt: (rule && dueDate(rule, seenAt)) ?? null, createdAt: seenAt,
      action: rule?.action ?? null, intervalDays: rule?.intervalDays ?? null, owner: null, overdue: false, validated: false,
    };
  });
}

/** Fixture mode's follow-up task, as the server makes it; none when the rule needs no follow-up. */
export function followUpTask(f: Finding, owner = "Attending doctor"): Task | undefined {
  if (!f.dueAt) return undefined;
  return { id: `finding-${f.id}`, title: findingLine({ label: f.label, action: f.action }), owner, due: localDate(new Date(f.dueAt)), completed: false, provenance: "clinician" };
}

/** Findings still to act on or follow up: overdue first, then the soonest due. */
export function toFollowUp(findings: Finding[], now = new Date()) {
  const due = (f: Finding) => (f.dueAt ? new Date(f.dueAt).getTime() : Infinity);
  return findings.filter(f => f.status !== "dismissed")
    .sort((a, b) => Number(isOverdue(b, now)) - Number(isOverdue(a, now)) || due(a) - due(b));
}

/** My Day with findings: each one is a row (red once overdue), standing in for its own task. */
export function withFindings(items: DayItem[], findings: Finding[], now = new Date()): DayItem[] {
  const shown = toFollowUp(findings, now);
  const tasks = new Set(shown.map(f => `task-${f.taskId}`));
  const rows = shown.map((f): DayItem => {
    const overdue = isOverdue(f, now), open = f.status === "open";
    return {
      id: `finding-${f.id}`, kind: "task", title: findingLine(f), detail: `${f.patientName} · ${f.owner ?? "Not tracked yet"}`,
      reason: overdue ? "Follow-up overdue" : open ? "Unvalidated finding · not tracked" : "Tracked follow-up",
      tone: overdue ? "urgent" : open ? "soon" : "routine", score: overdue ? 95 : open ? 55 : 30, patientId: f.patientId, open: { view: "xray" },
    };
  });
  return [...items.filter(i => !tasks.has(i.id)), ...rows].sort((a, b) => b.score - a.score);
}
