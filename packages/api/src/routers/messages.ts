import { ORPCError } from "@orpc/server";
import { user } from "@sona-ai/db/schema/auth";
import { admissions, careMessages, encounters, hospitalMembers, patients, tasks } from "@sona-ai/db/schema/clinical";
import { LABEL_RANK, type MessageLabel } from "@sona-ai/domain/messages";
import { and, asc, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { patientProcedure, protectedProcedure } from "../index";
import { stubModels } from "../models";
import { tellPatient, when } from "../push";
import type { Role } from "../roles";
import { lastDischarge, patientPlan } from "./care-plan";

/**
 * Sona Care messages: a plain thread between a patient and their care team. Each patient message is
 * one task for the attending doctor (on their visit, so it shows on My Day) and is triaged for the
 * care team's inbox (urgent, clinical, admin). A message is unanswered while its task is open: a
 * reply, "no reply needed" (messages.handle) or completing the task on My Day closes it. Both sides
 * are replay-safe by requestId. Not for emergencies; the app says so.
 */
const text = z.string().trim().min(1).max(1000);
const sendSchema = z.object({ text, requestId: z.string().min(1).max(100) });
const patientInput = z.object({ patientId: z.string().min(1) });
const TITLE_CHARS = 60;
/** The inbox keeps a thread for a week after its last message, so a handled one can be found again. */
const RECENT_DAYS = 7;
const CARE_TEAM: readonly Role[] = ["doctor", "nurse"];

const own = { id: careMessages.id, from: careMessages.from, text: careMessages.text, createdAt: careMessages.createdAt, seenAt: careMessages.seenAt };
const thread = (db: Context["db"], patientId: string) =>
  db.select(own).from(careMessages).where(eq(careMessages.patientId, patientId)).orderBy(asc(careMessages.createdAt), asc(careMessages.id));

async function stored(db: Context["db"], id: string) {
  const [row] = await db.select(own).from(careMessages).where(eq(careMessages.id, id));
  return row!;
}

/** Patient side, under care.messages. `seenAt` on the patient's own messages: when the care team opened them. */
export const careMessagesRouter = {
  list: patientProcedure.handler(({ context }) => thread(context.db, context.patientId)),
  send: patientProcedure.input(sendSchema).handler(async ({ context, input }) => {
    const { db, hospitalId, patientId } = context;
    const id = `message:${patientId}:${input.requestId}`;
    const [patient] = await db.select({ name: patients.name, encounterId: encounters.id }).from(patients)
      .leftJoin(encounters, eq(encounters.patientId, patients.id)).where(eq(patients.id, patientId)).orderBy(desc(encounters.updatedAt)).limit(1);
    const title = `${patient!.name.split(" ")[0]}: ${input.text.length > TITLE_CHARS ? `${input.text.slice(0, TITLE_CHARS).trimEnd()}…` : input.text}`;
    // Triage never blocks the send: a failed read leaves the message untriaged (the inbox reads it as clinical).
    const triage = await (context.models ?? stubModels).triageMessage({ text: input.text }).catch(error => { console.error("triage failed", error); return undefined; });
    // The task shares the message's ID, so a replay inserts neither.
    await db.insert(tasks).values({ id, hospitalId, encounterId: patient!.encounterId, kind: "message", title, owner: "Attending doctor", due: "Today", sourceId: id, idempotencyKey: id })
      .onConflictDoNothing();
    await db.insert(careMessages).values({ id, hospitalId, patientId, from: "patient", authorId: context.session.user.id, text: input.text, taskId: id, createdAt: clockOf(context), triage: triage?.label, triageReason: triage?.reason })
      .onConflictDoNothing();
    return stored(db, id);
  }),
};

async function ownPatient(db: Context["db"], hospitalId: string, patientId: string) {
  const [row] = await db.select({ id: patients.id, name: patients.name }).from(patients).where(and(eq(patients.id, patientId), eq(patients.hospitalId, hospitalId)));
  if (!row) throw new ORPCError("NOT_FOUND", { message: `No patient ${patientId}` });
  return row;
}

/** "Dr Aisyah", "Nurse Mei Ling": the account's name without its title (or the demo accounts' "Test"), titled by role. */
export function staffName(name: string | null, role: Role | null) {
  if (!name) return "Care team";
  const bare = name.replace(/^(dr\.?|nurse)\s+/i, "").replace(/\btest\s+/gi, "").trim();
  return role === "doctor" ? `Dr ${bare}` : role === "nurse" ? `Nurse ${bare}` : bare;
}

/** The thread as the care team reads it: who wrote each message, the patient's triage and when the team saw it. */
async function staffThread(db: Context["db"], patient: { id: string; name: string }) {
  const rows = await db.select({ ...own, authorName: user.name, authorRole: hospitalMembers.role, triage: careMessages.triage, triageReason: careMessages.triageReason, taskDone: tasks.completed })
    .from(careMessages).leftJoin(user, eq(user.id, careMessages.authorId)).leftJoin(hospitalMembers, eq(hospitalMembers.userId, careMessages.authorId)).leftJoin(tasks, eq(tasks.id, careMessages.taskId))
    .where(eq(careMessages.patientId, patient.id)).orderBy(asc(careMessages.createdAt), asc(careMessages.id));
  return rows.map(({ authorName, authorRole, taskDone, ...m }) => ({
    ...m, author: m.from === "patient" ? patient.name.split(" ")[0]! : staffName(authorName, authorRole),
    // A patient message is waiting while its task is open (a missing task counts as answered).
    unanswered: m.from === "patient" && taskDone === false,
  }));
}

/** Marks the patient's messages seen by the care team; how many were new. */
async function markSeen(context: Pick<Context, "db" | "now">, patientId: string) {
  return (await context.db.update(careMessages).set({ seenAt: clockOf(context) })
    .where(and(eq(careMessages.patientId, patientId), eq(careMessages.from, "patient"), isNull(careMessages.seenAt))).returning({ id: careMessages.id })).length;
}

/** Closes the patient's open message tasks (answered, or handled without a reply). */
async function closeAsked(db: Context["db"], patientId: string) {
  const asked = await db.select({ taskId: careMessages.taskId }).from(careMessages).where(and(eq(careMessages.patientId, patientId), eq(careMessages.from, "patient")));
  const ids = asked.flatMap(m => (m.taskId ? [m.taskId] : []));
  if (!ids.length) return 0;
  return (await db.update(tasks).set({ completed: true }).where(and(inArray(tasks.id, ids), eq(tasks.completed, false))).returning({ id: tasks.id })).length;
}

const labelOf = (t: string | null): MessageLabel => (t === "urgent" || t === "admin" ? t : "clinical");

/** Clinician side: the inbox, a patient's thread, Sona's draft, and the care team's reply. */
export const messagesRouter = {
  /**
   * One row per patient thread with a message waiting or one in the last week: waiting threads first,
   * urgent before clinical before admin, then longest waiting; handled threads after, newest first.
   * ponytail: reads the hospital's recent and waiting messages in one pass; page it once threads number in the thousands.
   */
  inbox: protectedProcedure.handler(async ({ context }) => {
    const { db, hospitalId } = context, now = clockOf(context);
    const since = new Date(now.getTime() - RECENT_DAYS * 86400_000);
    const rows = await db.select({ patientId: careMessages.patientId, from: careMessages.from, text: careMessages.text, createdAt: careMessages.createdAt, seenAt: careMessages.seenAt,
      triage: careMessages.triage, triageReason: careMessages.triageReason, taskDone: tasks.completed, name: patients.name, initials: patients.initials })
      .from(careMessages).innerJoin(patients, eq(patients.id, careMessages.patientId)).leftJoin(tasks, eq(tasks.id, careMessages.taskId))
      .where(and(eq(careMessages.hospitalId, hospitalId), or(gte(careMessages.createdAt, since), eq(tasks.completed, false))))
      .orderBy(asc(careMessages.createdAt), asc(careMessages.id));
    const ids = [...new Set(rows.map(r => r.patientId))];
    const beds = ids.length ? await db.select({ patientId: admissions.patientId, bed: admissions.bed }).from(admissions)
      .where(and(eq(admissions.hospitalId, hospitalId), inArray(admissions.patientId, ids), isNull(admissions.dischargedAt))) : [];
    const threads = ids.map(patientId => {
      const msgs = rows.filter(r => r.patientId === patientId), last = msgs.at(-1)!;
      const waiting = msgs.filter(m => m.from === "patient" && m.taskDone === false);
      const top = waiting.reduce<(typeof waiting)[number] | undefined>((best, m) => !best || LABEL_RANK[labelOf(m.triage)] > LABEL_RANK[labelOf(best.triage)] ? m : best, undefined);
      return {
        patientId, name: last.name, initials: last.initials, bed: beds.find(b => b.patientId === patientId)?.bed ?? null,
        lastText: last.text, lastFrom: last.from, lastAt: last.createdAt,
        waitingSince: waiting[0]?.createdAt ?? null, waiting: waiting.length,
        unread: msgs.filter(m => m.from === "patient" && !m.seenAt).length,
        label: top ? labelOf(top.triage) : null, reason: top ? (top.triageReason ?? "Not triaged: read it first") : null,
        handled: !waiting.length,
      };
    });
    const rank = (t: (typeof threads)[number]) => (t.label ? LABEL_RANK[t.label] : 0);
    return { now, threads: threads.sort((a, b) => Number(a.handled) - Number(b.handled) || rank(b) - rank(a)
      || (a.waitingSince && b.waitingSince ? a.waitingSince.getTime() - b.waitingSince.getTime() : b.lastAt.getTime() - a.lastAt.getTime())) };
  }),

  /** The patient sheet's compact thread (authors and times), without marking anything seen. */
  list: protectedProcedure.input(patientInput).handler(async ({ context, input }) => staffThread(context.db, await ownPatient(context.db, context.hospitalId, input.patientId))),

  /** The inbox thread: opening it as a doctor or nurse marks the patient's messages seen (Sona Care shows "Seen by care team"). */
  thread: protectedProcedure.input(patientInput).handler(async ({ context, input }) => {
    const patient = await ownPatient(context.db, context.hospitalId, input.patientId);
    // A read is not announced by the middleware, so a thread that became seen tells Sona Care itself.
    if (CARE_TEAM.includes(context.role) && await markSeen(context, patient.id) && context.announce)
      await context.announce(context.hospitalId, { topic: "messages", patientId: patient.id }).catch(() => {});
    const [bed] = await context.db.select({ bed: admissions.bed }).from(admissions).where(and(eq(admissions.patientId, patient.id), eq(admissions.hospitalId, context.hospitalId), isNull(admissions.dischargedAt)));
    const [visit] = await context.db.select({ id: encounters.id }).from(encounters).where(eq(encounters.patientId, patient.id)).orderBy(desc(encounters.updatedAt)).limit(1);
    return { patient: { id: patient.id, name: patient.name, bed: bed?.bed ?? null, encounterId: visit?.id ?? null }, messages: await staffThread(context.db, patient) };
  }),

  /**
   * Sona's suggested reply to the latest waiting message, grounded only in the patient's own plan (their
   * medicines and next visit, in their discharge language); null when nothing is waiting. The source says
   * whether a model or the rule-based template wrote it. A person checks it before it is sent.
   */
  draft: protectedProcedure.input(patientInput).handler(async ({ context, input }) => {
    const patient = await ownPatient(context.db, context.hospitalId, input.patientId);
    const latest = (await staffThread(context.db, patient)).filter(m => m.unanswered).at(-1);
    if (!latest) return null;
    const discharged = await lastDischarge(context.db, context.hospitalId, patient.id);
    // A message written in Chinese is answered in Chinese, whatever the leaflet's language.
    const language = /[一-鿿]/.test(latest.text) ? "zh" : discharged?.language ?? "en";
    const plan = await patientPlan({ ...context, patientId: patient.id }, language);
    const label = latest.triage ? labelOf(latest.triage) : "clinical";
    const models = context.models ?? stubModels;
    const reply = await models.draftReply({
      text: latest.text, label, patientFirstName: patient.name.split(" ")[0]!, language,
      // ponytail: the discharge review is the next visit; booked clinic visits join once the draft needs them.
      plan: plan.status === "discharged" ? { medicines: Object.values(plan.medicines).flat(), nextVisit: plan.followUp ? `${plan.followUp.title}, ${when(new Date(plan.followUp.date), language)}` : undefined } : undefined,
    });
    return { messageId: latest.id, label, reason: latest.triageReason ?? "Not triaged: read it first", ...reply };
  }),

  /** "No reply needed": closes the patient's waiting messages (and their tasks on My Day) without writing to them. */
  handle: protectedProcedure.input(patientInput).handler(async ({ context, input }) => {
    const patient = await ownPatient(context.db, context.hospitalId, input.patientId);
    await markSeen(context, patient.id);
    return { handled: await closeAsked(context.db, patient.id) };
  }),

  reply: protectedProcedure.input(sendSchema.extend({ patientId: z.string().min(1) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    await ownPatient(db, hospitalId, input.patientId);
    const id = `message:${input.patientId}:${input.requestId}`;
    await db.insert(careMessages).values({ id, hospitalId, patientId: input.patientId, from: "care-team", authorId: context.session.user.id, text: input.text, createdAt: clockOf(context) })
      .onConflictDoNothing();
    // Answering closes the patient's open message tasks on My Day, and whoever answered has seen them.
    await markSeen(context, input.patientId);
    await closeAsked(db, input.patientId);
    await tellPatient(context, hospitalId, input.patientId, { kind: "reply" });
    return stored(db, id);
  }),
};
