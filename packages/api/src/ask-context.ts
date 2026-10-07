import { appointments, bookingRequests, encounters, labResults, patients, tasks } from "@sona-ai/db/schema/clinical";
import { bedKind } from "@sona-ai/domain/ward";
import { and, asc, desc, eq, gte, isNull, lt } from "drizzle-orm";

import { freeAnswer, pageLines } from "./ask-model";
import { checkAskSpec, type AskContext, type AskSpec } from "./ask-spec";
import type { Baseten } from "./baseten-models";
import { clockOf, type Context } from "./context";
import { refusal, type Role } from "./roles";
import { liveBeds, ownersOf } from "./routers/ward";

/**
 * Sona Pro web's bar asks from any page, and the page sends nothing (ask.free, scope "web"): the server reads what the
 * Today, Ward and Tasks pages show for the clinician's hospital and role, answers the bar's three questions from it by
 * the iPhone's rules (apps/native/features/ask/answers.ts: needsYou, soonest's blocked beds, overdue), no model, and
 * hands the same data to the model for any other question. With the model off it says what the pages show that
 * matches the question's words, or plainly that the model is off; never an empty answer.
 */
type Row = AskContext["rows"][number];
type Asker = Pick<Context, "db" | "now"> & { hospitalId: string; role: Role };

const MYT = 8 * 3600_000; // ponytail: every demo hospital keeps Malaysian time, as day.list does
const dayOf = (at: Date) => new Date(at.getTime() + MYT).toISOString().slice(0, 10);
const timeOf = (at: Date) => new Date(at.getTime() + MYT).toISOString().slice(11, 16);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (text: string, length: number) => text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
const column = (lead: string, rows: Row[]): AskSpec => checkAskSpec({ root: "w", elements: {
  w: { type: "AskColumn", props: {}, children: rows.length ? ["w-0", "w-1"] : ["w-0"] },
  "w-0": { type: "AskLead", props: { text: clip(lead, 280) }, children: [] },
  ...rows.length > 0 && { "w-1": { type: "AskRows", props: { rows }, children: [] } },
} })!;

/** The three answers and the page data (the iPhone's `askContext` shape: each answer's question and lead, and the rows, at most 40). */
export async function webPage(asker: Asker) {
  const { db, hospitalId, role } = asker, now = clockOf(asker), today = dayOf(now);
  const may = (route: string) => !refusal(role, route);
  const dayStart = new Date(`${today}T00:00:00+08:00`);
  const [open, beds, owners, results, incomplete, requests, visits] = await Promise.all([
    db.select({ task: tasks, patientId: patients.id, patient: patients.name }).from(tasks)
      .leftJoin(encounters, eq(encounters.id, tasks.encounterId)).leftJoin(patients, eq(patients.id, encounters.patientId))
      .where(and(eq(tasks.hospitalId, hospitalId), eq(tasks.completed, false))).orderBy(asc(tasks.createdAt)),
    liveBeds(db, hospitalId),
    ownersOf(db, hospitalId),
    // A result waiting on someone (not acknowledged, not still at the lab, not normal), newest first as on the iPhone: only for the roles that see results.
    may("results.list") ? db.select({ patientId: patients.id, name: patients.name, test: labResults.test, value: labResults.value, unit: labResults.unit, flag: labResults.flag })
      .from(labResults).innerJoin(patients, eq(patients.id, labResults.patientId))
      .where(and(eq(patients.hospitalId, hospitalId), isNull(labResults.acknowledgedAt))).orderBy(desc(labResults.receivedAt)) : [],
    db.select({ id: patients.id, name: patients.name }).from(patients).where(and(eq(patients.hospitalId, hospitalId), eq(patients.incomplete, true))),
    may("bookings.list") ? db.select({ patientId: patients.id, name: patients.name, startsAt: bookingRequests.startsAt }).from(bookingRequests)
      .innerJoin(patients, eq(patients.id, bookingRequests.patientId))
      .where(and(eq(bookingRequests.hospitalId, hospitalId), eq(bookingRequests.status, "requested"))) : [],
    db.select({ patientId: appointments.patientId, name: patients.name, kind: appointments.kind, startsAt: appointments.startsAt }).from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .where(and(eq(appointments.hospitalId, hospitalId), gte(appointments.startsAt, now), lt(appointments.startsAt, new Date(dayStart.getTime() + 86_400_000))))
      .orderBy(asc(appointments.startsAt)),
  ]);

  // Tasks as the Tasks page groups them (apps/native/features/tasks/counts.ts dueGroup): a date before today is overdue.
  const groupOf = (due: string | null) => due === "Today" || due === today ? "today" : due && /^\d{4}-\d{2}-\d{2}$/.test(due) && due < today ? "overdue" : "later";
  const taskRow = ({ task, patientId, patient }: (typeof open)[number]): Row => {
    const group = groupOf(task.due);
    return { id: task.id.slice(0, 64), title: clip(task.title, 120), detail: clip([patient ?? "Ward task", task.owner, group === "overdue" ? `was due ${task.due}` : group === "today" ? "due today" : task.due ? `due ${task.due}` : "no date"].join(" · "), 160),
      tone: group === "overdue" ? "soon" : "calm", ...Boolean(patientId) && { op: `open:${patientId}` } };
  };
  const late = open.filter(t => groupOf(t.task.due) === "overdue"), dueToday = open.filter(t => groupOf(t.task.due) === "today");

  // Who needs you first, the iPhone's ranking (day/counts needsYou): a result waiting 100, a booking request 75, missing history 50,
  // one row per patient led by their most urgent reason; overdue tasks rank 80, between a result and a booking.
  const needs = new Map<string, Row & { score: number }>();
  const flag = (patientId: string, name: string, detail: string, score: number) => {
    if ((needs.get(patientId)?.score ?? -1) < score) needs.set(patientId, { id: patientId, title: clip(name, 120), detail: clip(detail, 160), tone: score >= 100 ? "urgent" : "soon", op: `open:${patientId}`, score });
  };
  for (const r of results) if (r.flag && r.flag !== "pending" && r.flag !== "normal") flag(r.patientId, r.name, `${r.flag.replace("-", " ")} ${r.test} ${r.value}${r.unit ? ` ${r.unit}` : ""} · result to review`, r.flag.startsWith("critical") ? 110 : 100);
  for (const b of requests) flag(b.patientId, b.name, `Booking request for ${dayOf(b.startsAt)} ${timeOf(b.startsAt)} · confirm or decline`, 75);
  for (const p of incomplete) flag(p.id, p.name, "History incomplete", 50);
  const ranked = [...needs.values(), ...late.map(t => ({ ...taskRow(t), score: 80 }))].sort((a, b) => b.score - a.score).map(({ score: _, ...row }) => row);
  const patientsNeeding = needs.size;
  const needsLead = ranked.length
    ? `${[patientsNeeding ? `${plural(patientsNeeding, "patient")}` : "", late.length ? plural(late.length, "overdue task") : ""].filter(Boolean).join(" and ")} ${ranked.length === 1 ? "needs" : "need"} you, most urgent first: ${ranked[0]!.title}, ${ranked[0]!.detail.split(" · ")[0]}.`
    : "Nothing needs you right now: no result waiting, no incomplete record, nothing overdue.";

  // Blocked beds (the Ward's blocked filter: fit to go, something holding the bed), each blocker with its owner or none yet.
  const held = beds.filter(b => bedKind(b) === "blocked");
  const hours = held.reduce((n, b) => n + (b.waitingHours ?? 0), 0);
  const blockedRows: Row[] = held.map(b => ({ id: b.bed.slice(0, 64), title: clip(`${b.bed} · ${b.name}`, 120),
    detail: clip(b.blockers.map(x => `${x.label} (${owners[x.id] ?? "no owner"})`).join(", "), 160), tone: "soon", ...Boolean(b.patientId) && { op: `open:${b.patientId}` } }));
  const unowned = held.flatMap(b => b.blockers).filter(x => !owners[x.id]).length;
  const blockedLead = held.length ? `${plural(held.length, "bed")} ${held.length === 1 ? "is" : "are"} blocked, about ${hours} bed-hours waiting${unowned ? `; ${plural(unowned, "blocker")} ${unowned === 1 ? "has" : "have"} no owner yet` : ""}.` : "No bed is blocked: every patient fit to go has nothing holding the bed.";

  // Due today: overdue and today's tasks, then the visits still to come today.
  const visitRows: Row[] = visits.map(v => ({ id: `visit-${v.patientId}-${timeOf(v.startsAt)}`.slice(0, 64), title: clip(v.name, 120), detail: clip(`Visit at ${timeOf(v.startsAt)} · ${v.kind}`, 160), tone: "calm", op: `open:${v.patientId}` }));
  const dueRows = [...late.map(taskRow), ...dueToday.map(taskRow), ...visitRows];
  const dueLead = dueRows.length ? `${[late.length ? `${plural(late.length, "task")} overdue` : "", dueToday.length ? `${dueToday.length} due today` : "", visits.length ? `${plural(visits.length, "visit")} still to come today` : ""].filter(Boolean).join(", ")}.` : "Nothing is overdue or due today, and no visit is still to come.";

  const answers = { needs: { question: "What needs me first?", lead: needsLead, rows: ranked }, blocked: { question: "Which beds are blocked?", lead: blockedLead, rows: blockedRows }, due: { question: "What is due today?", lead: dueLead, rows: dueRows } };
  // The page data for the model: the three answers, then every other open task (the Tasks page), within the schema's limits.
  const rows = new Map<string, Row>();
  for (const row of [...ranked, ...blockedRows, ...dueRows, ...open.map(taskRow)]) if (!rows.has(row.id)) rows.set(row.id, row);
  const context: AskContext = { lines: [...Object.values(answers).map(a => clip(`${a.question} ${a.lead}`, 300)), `Open tasks: ${open.length}.`], rows: [...rows.values()].slice(0, 40) };
  return { context, specs: { needs: column(needsLead, ranked), blocked: column(blockedLead, blockedRows), due: column(dueLead, dueRows) } };
}

/**
 * Which of the bar's three questions this is, in English or Malay ("apa perlu saya buat dulu", "katil mana tersekat",
 * "apa yang perlu hari ini"); undefined for anything else. "First" wins over "today", and a bare "need" comes last,
 * so "apa yang perlu hari ini" is what is due, not who needs you.
 */
export function ruleFor(question: string): "needs" | "blocked" | "due" | undefined {
  const q = question.toLowerCase();
  if (/\b(first|urgent|dulu|segera)\b/.test(q)) return "needs";
  if (/block|tersekat|stuck|\bkatil\b|\bbeds?\b/.test(q)) return "blocked";
  if (/\bdue\b|today|overdue|hari ini|\btasks?\b|tugas/.test(q)) return "due";
  if (/\bneeds?\b|perlu/.test(q)) return "needs";
  return undefined;
}

const OFF = "Sona's assistant model is off right now; ask again when it is on, or open Today, Ward or Tasks.";

/** ask.free for the web: the bar's questions by rule; anything else by the model with the page data, else what the pages say, else the off line. */
export async function webAnswer(asker: Asker & { baseten?: Baseten }, question: string) {
  const page = await webPage(asker);
  const rule = ruleFor(question);
  if (rule) return { source: "rules" as const, spec: page.specs[rule] };
  const asked = asker.baseten ? await freeAnswer(asker.baseten, { scope: "web", question, context: page.context }) : undefined;
  if (asked?.spec && asked.source === "model") return asked;
  const said = pageLines(page.context, question);
  if (said) return { source: "rules" as const, spec: said };
  const waking = asked && "waking" in asked ? asked.waking : undefined;
  return { source: "fixture" as const, spec: column(waking ? `Sona's assistant model is starting (about ${waking} min); ask again then, or open Today, Ward or Tasks.` : OFF, []), ...waking && { waking } };
}
