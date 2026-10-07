import { addDays } from "@/features/today/time";
import { today } from "@/features/ward/state";

import { fixture, rows } from "./fixture";

// /pro/tasks (replaces the pro-session.ts seed; the sidebar badge counts open tasks, so most stay open). Titles reach
// the create limit of 200, owners the 80 the form allows, due is free text up to 40 when a discharge plan writes it.
const on = today();
const ME = "Dr Aleksandra Wiśniewska-Kowalczyk"; // clinician.me in pro-session.ts
const KINDS = ["followup", "blocker-owner", "coding-query", "discharge", "finding", "check-in", "message", "booking"] as const;
const LEAD = [
  {
    title: "Chase the repeat serum potassium and magnesium for Siti Nur Aisyah binti Mohd Khairuddin before the 4 pm ward round, then tell the night registrar whether to restart spironolactone 25 mg OD",
    owner: "Muthukumaran a/l Subramaniam Pillai (Senior Staff Nurse, Wad Kardiologi 4B)", due: addDays(on, -12),
  },
  { title: "ECG", owner: "Jo", due: on },
  { title: "Attach IMG_20250914_183022_HDR_portrait_edited_edited.HEIC (wound photo) to the discharge summary", owner: ME, due: null },
  { title: "Confirm Đặng Thị Ngọc Hân's TTO with pharmacy", owner: "王秀英", due: "Before discharge, after the consultant's round" },
  { title: "Code the admission: I21.4 NSTEMI vs I20.0 unstable angina, the insurer's GL needs one", owner: "Coding", due: "1 day after discharge" },
  { title: "Call Seán O'Brien-Ó Súilleabháin's daughter about transport", owner: ME, due: addDays(on, 400) },
];
const task = (i: number) => {
  const lead = LEAD[i];
  return {
    id: `t-${i}`, hospitalId: "h-ukm", encounterId: i % 7 === 2 ? null : `e-9f8e7d6c-${i % 40}`, kind: KINDS[i % KINDS.length]!,
    title: lead?.title ?? `Repeat the troponin for bed 4B-${(i % 32) + 1} at 6 hours`, owner: lead?.owner ?? (i % 3 ? ME : "Dr Lim"),
    due: lead ? lead.due : i % 5 === 0 ? null : addDays(on, (i % 9) - 4), completed: i >= LEAD.length && i % 6 === 0,
    sourceId: null, idempotencyKey: null, createdAt: new Date(Date.UTC(2026, 9, 7, 1) - i * 60_000),
  };
};

export default [
  fixture("tasks.list", { worst: rows(1284, task), empty: [], one: [task(0)], huge: rows(1000, task) }),
];
