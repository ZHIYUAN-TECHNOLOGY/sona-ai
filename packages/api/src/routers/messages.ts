import { ORPCError } from "@orpc/server";
import { user } from "@sona-ai/db/schema/auth";
import { admissions, careMessages, encounters, hospitalMembers, patients, provenance, tasks, type MedicineReading, type MessageAttachment } from "@sona-ai/db/schema/clinical";
import type { Language } from "@sona-ai/domain/discharge";
import { LABEL_RANK, type MessageLabel } from "@sona-ai/domain/messages";
import { defaultMedications } from "@sona-ai/domain/prescribing";
import { mergeMedicines } from "@sona-ai/domain/scan";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { answerOnce, originOf } from "../answers";
import { SAMPLE_PHOTO_KEY } from "../contracts";
import { clockOf, type Context } from "../context";
import { patientProcedure, protectedProcedure } from "../index";
import { stubModels } from "../models";
import { tellPatient, tellStaff, when } from "../push";
import type { Role } from "../roles";
import { lastDischarge, patientPlan } from "./care-plan";
import { SONA_AUTHOR, ruleOf, tellCall999 } from "./check-ins";
import { editEncounter, loadEncounter, visitOf } from "./encounter";
import { bucket } from "./xray";

/**
 * Sona Care messages: a plain thread between a patient and their care team. Each patient message is
 * one task for the attending doctor (on their visit, so it shows on My Day) and is triaged for the
 * care team's inbox (urgent, clinical, admin). A message is unanswered while its task is open: a
 * reply, "no reply needed" (messages.handle) or completing the task on My Day closes it. Both sides
 * are replay-safe by requestId. Not for emergencies; the app says so.
 */
const text = z.string().trim().min(1).max(1000);
const sendSchema = z.object({ text, requestId: z.string().min(1).max(100) });
const readingSchema = z.object({ name: z.string().trim().min(1).max(120), dose: z.string().trim().max(60).optional(), frequency: z.string().trim().max(120).optional() });
/** What a patient may attach: the photo's key (theirs, or the sample) and the reading they checked. The decision is never theirs to send. */
const attachmentSchema = z.object({ kind: z.literal("medicine-photo"), key: z.string().min(1).max(300).optional(), reading: readingSchema, sampleReading: z.boolean().optional() });
const messageInput = z.object({ messageId: z.string().min(1).max(300) });
const patientInput = z.object({ patientId: z.string().min(1) });
const TITLE_CHARS = 60;
/** The inbox keeps a thread for a week after its last message, so a handled one can be found again. */
const RECENT_DAYS = 7;
const CARE_TEAM: readonly Role[] = ["doctor", "nurse"];
/** The language to answer a message in: Chinese when it is written in Chinese, else the leaflet's (English before discharge). */
const answerIn = (text: string, leaflet?: Language): Language => /[一-鿿]/.test(text) ? "zh" : leaflet ?? "en";

const own = { id: careMessages.id, from: careMessages.from, text: careMessages.text, createdAt: careMessages.createdAt, seenAt: careMessages.seenAt, attachment: careMessages.attachment };
/** The patient's own thread. `rule` marks Sona's call-999 line as the safety rule's template (check-ins' ruleOf); staff ids stay out of it. */
const thread = async (db: Context["db"], patientId: string) =>
  (await db.select({ ...own, authorId: careMessages.authorId }).from(careMessages).where(eq(careMessages.patientId, patientId)).orderBy(asc(careMessages.createdAt), asc(careMessages.id)))
    .map(({ authorId, ...m }) => ({ ...m, ...ruleOf(authorId) }));

/** A message's triage as provenance keeps it (care_messages has no column for who triaged): one row per message. */
const triageId = (messageId: string) => `triage:${messageId}`;
const triageJoin = eq(provenance.id, sql`'triage:' || ${careMessages.id}`);
/**
 * Who triaged a patient's message, so the inbox never shows the rule's label, or the default one, as a model's reading:
 * the model (and whether the rule's urgent words decided over it), "fixture" for the rules alone, "none" when triage
 * did not run (it failed; the label shown is only the default), "unknown" for a message from before this was kept.
 * Spread into a row only where there is a patient message to speak of, so the field is optional and the apps' own
 * sample rows, built to the same types, still stand.
 */
function triagedBy(m: { triage: string | null; triageModel: string | null; triageRead: unknown }) {
  if (!m.triage) return { source: "none" as const };
  const by = originOf(m.triageModel);
  if (by.source !== "model") return by;
  return { ...by, decidedBy: (m.triageRead as { decidedBy?: string } | null)?.decidedBy === "rules" ? "rules" as const : "model" as const };
}

async function stored(db: Context["db"], id: string) {
  const [row] = await db.select(own).from(careMessages).where(eq(careMessages.id, id));
  return row!;
}

/** Patient side, under care.messages. `seenAt` on the patient's own messages: when the care team opened them. */
export const careMessagesRouter = {
  list: patientProcedure.handler(({ context }) => thread(context.db, context.patientId)),
  send: patientProcedure.input(sendSchema.extend({ attachment: attachmentSchema.optional() })).handler(async ({ context, input }) => {
    const { db, hospitalId, patientId } = context;
    const id = `message:${patientId}:${input.requestId}`;
    // A photo key must be one of their own uploads (care.readMedicinePhoto) or the bundled sample.
    const key = input.attachment?.key;
    if (key && key !== SAMPLE_PHOTO_KEY && !key.startsWith(`care-photos/${hospitalId}/${patientId}/`)) throw new ORPCError("BAD_REQUEST", { message: "That photo isn't yours" });
    const [patient] = await db.select({ name: patients.name, encounterId: encounters.id }).from(patients)
      .leftJoin(encounters, eq(encounters.patientId, patients.id)).where(eq(patients.id, patientId)).orderBy(desc(encounters.updatedAt)).limit(1);
    const title = `${patient!.name.split(" ")[0]}: ${input.text.length > TITLE_CHARS ? `${input.text.slice(0, TITLE_CHARS).trimEnd()}…` : input.text}`;
    // Triage never blocks the send: a failed read leaves the message untriaged (the inbox lists it as clinical, and
    // says triage did not run: triagedBy "none").
    const triage = await (context.models ?? stubModels).triageMessage({ text: input.text }).catch(error => { console.error("triage failed", error); return undefined; });
    // Who triaged it is logged as every AI output is; keyed by the message, so a replay keeps the first reading's.
    if (triage) await db.insert(provenance).values({
      id: triageId(id), encounterId: patient!.encounterId, kind: "message-triage", output: { label: triage.label, reason: triage.reason, decidedBy: triage.source === "model" ? triage.decidedBy ?? "model" : "rules" },
      sourceIds: [id], model: triage.source === "model" ? triage.model : "fixture", approvedBy: null,
    }).onConflictDoNothing();
    // The task shares the message's ID, so a replay inserts neither.
    const [asked] = await db.insert(tasks).values({ id, hospitalId, encounterId: patient!.encounterId, kind: "message", title, owner: "Attending doctor", due: "Today", sourceId: id, idempotencyKey: id })
      .onConflictDoNothing().returning({ id: tasks.id });
    // Only an urgent one is a My Day row, so only that one reaches a locked phone; a resend pushes nothing.
    if (asked && triage?.label === "urgent") await tellStaff(context, hospitalId, { title: "Urgent message", body: title });
    const at = clockOf(context);
    await db.insert(careMessages).values({ id, hospitalId, patientId, from: "patient", authorId: context.session.user.id, text: input.text, taskId: id, createdAt: at, triage: triage?.label, triageReason: triage?.reason, attachment: input.attachment })
      .onConflictDoNothing();
    // An emergency sign waits for no one: Sona tells them to call 999 at once, as for an urgent check-in reply, just after
    // their message in the thread (the middleware's "messages" change shows it). Keyed by the message, so a resend tells them once.
    if (triage?.label === "urgent")
      await tellCall999(context, hospitalId, { id: patientId, name: patient!.name }, input.requestId, answerIn(input.text, (await lastDischarge(db, hospitalId, patientId))?.language), new Date(at.getTime() + 1));
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

/**
 * The thread as the care team reads it: who wrote each message, the patient's triage and who made it (`triagedBy`),
 * when the team saw it, and `rule` on Sona's call-999 line (a safety rule's template, not a person's or a model's words).
 */
async function staffThread(db: Context["db"], patient: { id: string; name: string }) {
  const rows = await db.select({ ...own, authorId: careMessages.authorId, authorName: user.name, authorRole: hospitalMembers.role, triage: careMessages.triage, triageReason: careMessages.triageReason, taskDone: tasks.completed,
    triageModel: provenance.model, triageRead: provenance.output })
    .from(careMessages).leftJoin(user, eq(user.id, careMessages.authorId)).leftJoin(hospitalMembers, eq(hospitalMembers.userId, careMessages.authorId)).leftJoin(tasks, eq(tasks.id, careMessages.taskId))
    .leftJoin(provenance, triageJoin)
    .where(eq(careMessages.patientId, patient.id)).orderBy(asc(careMessages.createdAt), asc(careMessages.id));
  return rows.map(({ authorId, authorName, authorRole, taskDone, triageModel, triageRead, ...m }) => ({
    ...m, ...m.from === "patient" && { triagedBy: triagedBy({ ...m, triageModel, triageRead }) }, ...ruleOf(authorId),
    author: m.from === "patient" ? patient.name.split(" ")[0]! : staffName(authorName, authorRole),
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
/** "Cetirizine 10 mg": the photo's medicine as the inbox row names it. */
export const photoLabel = (r: MedicineReading) => [r.name, r.dose].filter(Boolean).join(" ");

/** A patient's medicine-photo message in this hospital, or NOT_FOUND. */
async function photoMessage(db: Context["db"], hospitalId: string, messageId: string) {
  const [m] = await db.select({ id: careMessages.id, patientId: careMessages.patientId, taskId: careMessages.taskId, attachment: careMessages.attachment }).from(careMessages)
    .where(and(eq(careMessages.id, messageId), eq(careMessages.hospitalId, hospitalId), eq(careMessages.from, "patient")));
  if (m?.attachment?.kind !== "medicine-photo") throw new ORPCError("NOT_FOUND", { message: "No medicine photo in that message" });
  return { ...m, attachment: m.attachment };
}

/** The care team's calm reply when a photographed medicine isn't one of the patient's, in their discharge language. */
const DECLINED = {
  en: (m: string) => `Thank you for the photo. ${m} isn't one of the medicines we've given you, so please don't take it until you've checked with us.`,
  ms: (m: string) => `Terima kasih atas gambar itu. ${m} bukan salah satu ubat yang kami berikan kepada anda, jadi jangan ambil sehingga anda bertanya kepada kami dahulu.`,
  zh: (m: string) => `谢谢您的照片。${m}不是我们给您的药物，请先问过我们再服用。`,
};

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

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
    const rows = await db.select({ patientId: careMessages.patientId, from: careMessages.from, text: careMessages.text, createdAt: careMessages.createdAt, seenAt: careMessages.seenAt, attachment: careMessages.attachment,
      triage: careMessages.triage, triageReason: careMessages.triageReason, taskDone: tasks.completed, name: patients.name, initials: patients.initials, authorId: careMessages.authorId,
      triageModel: provenance.model, triageRead: provenance.output })
      .from(careMessages).innerJoin(patients, eq(patients.id, careMessages.patientId)).leftJoin(tasks, eq(tasks.id, careMessages.taskId)).leftJoin(provenance, triageJoin)
      .where(and(eq(careMessages.hospitalId, hospitalId), or(gte(careMessages.createdAt, since), eq(tasks.completed, false))))
      .orderBy(asc(careMessages.createdAt), asc(careMessages.id));
    const ids = [...new Set(rows.map(r => r.patientId))];
    const beds = ids.length ? await db.select({ patientId: admissions.patientId, bed: admissions.bed }).from(admissions)
      .where(and(eq(admissions.hospitalId, hospitalId), inArray(admissions.patientId, ids), isNull(admissions.dischargedAt))) : [];
    const threads = ids.map(patientId => {
      // Sona's own "call 999" line is not the thread's last word: the row (and My Day's urgent row) keeps the patient's.
      const msgs = rows.filter(r => r.patientId === patientId), last = msgs.findLast(m => m.authorId !== SONA_AUTHOR) ?? msgs.at(-1)!;
      const waiting = msgs.filter(m => m.from === "patient" && m.taskDone === false);
      const top = waiting.reduce<(typeof waiting)[number] | undefined>((best, m) => !best || LABEL_RANK[labelOf(m.triage)] > LABEL_RANK[labelOf(best.triage)] ? m : best, undefined);
      return {
        patientId, name: last.name, initials: last.initials, bed: beds.find(b => b.patientId === patientId)?.bed ?? null,
        lastText: last.text, lastFrom: last.from, lastAt: last.createdAt,
        // The last message was a medicine photo: the row says "Photo · Cetirizine 10 mg" instead of its words.
        lastPhoto: last.attachment?.kind === "medicine-photo" ? photoLabel(last.attachment.reading) : null,
        waitingSince: waiting[0]?.createdAt ?? null, waiting: waiting.length,
        unread: msgs.filter(m => m.from === "patient" && !m.seenAt).length,
        label: top ? labelOf(top.triage) : null, reason: top ? (top.triageReason ?? "Not triaged: read it first") : null,
        // Who gave the row its label: a model, the rules, or no one ("none": triage did not run, the label is the default).
        ...top && { triagedBy: triagedBy(top) },
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
   * whether a model or the rule-based template wrote it. A person checks it before it is sent. A model drafts
   * once per message and plan: opening the thread again shows the same draft.
   */
  draft: protectedProcedure.input(patientInput).handler(async ({ context, input }) => {
    const patient = await ownPatient(context.db, context.hospitalId, input.patientId);
    const latest = (await staffThread(context.db, patient)).filter(m => m.unanswered).at(-1);
    if (!latest) return null;
    const discharged = await lastDischarge(context.db, context.hospitalId, patient.id);
    const language = answerIn(latest.text, discharged?.language);
    const plan = await patientPlan({ ...context, patientId: patient.id }, language);
    const label = latest.triage ? labelOf(latest.triage) : "clinical";
    const asked = {
      text: latest.text, label, patientFirstName: patient.name.split(" ")[0]!, language,
      // ponytail: the discharge review is the next visit; booked clinic visits join once the draft needs them.
      plan: plan.status === "discharged" ? { medicines: Object.values(plan.medicines).flat(), nextVisit: plan.followUp ? `${plan.followUp.title}, ${when(new Date(plan.followUp.date), language)}` : undefined } : undefined,
    };
    const reply = await answerOnce(context.db, null, "reply-draft", { messageId: latest.id, ...asked }, () => (context.models ?? stubModels).draftReply(asked), () => [latest.id]);
    // `source` and `model` are the draft's; `triagedBy` is the label's, which a different reader (or none) may have given.
    return { messageId: latest.id, label, reason: latest.triageReason ?? "Not triaged: read it first", triagedBy: latest.triagedBy, ...reply };
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

  /** A patient's medicine photo, for a doctor or nurse to look at (short-lived: base64 in the answer, never a public link). */
  photo: protectedProcedure.input(messageInput).handler(async ({ context, input }) => {
    const { attachment } = await photoMessage(context.db, context.hospitalId, input.messageId);
    const object = attachment.key && attachment.key !== SAMPLE_PHOTO_KEY ? await bucket(context).get(attachment.key) : null;
    if (!object) throw new ORPCError("NOT_FOUND", { message: "That photo isn't stored: it is the sample, or it stayed on the patient's phone" });
    return { contentType: object.httpMetadata?.contentType ?? "image/jpeg", dataBase64: toBase64(new Uint8Array(await object.arrayBuffer())) };
  }),

  /**
   * The care team's decision on a medicine photo, once. "add": the medicine joins the visit's reconciliation
   * unconfirmed (from the patient's photo), for the doctor to confirm; "reject": a calm reply tells the patient
   * not to take it. Either closes the message's task; Sona Care shows "Added by your care team" or drops it.
   * Deciding again returns the first decision and changes nothing.
   */
  resolveMedicinePhoto: protectedProcedure.input(messageInput.extend({ decision: z.enum(["add", "reject"]), edited: readingSchema.optional() })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const message = await photoMessage(db, hospitalId, input.messageId);
    if (message.attachment.decision) return message.attachment.decision;
    const reading = input.edited ?? message.attachment.reading;
    const [visit] = await db.select({ id: encounters.id }).from(encounters).where(and(eq(encounters.patientId, message.patientId), eq(encounters.hospitalId, hospitalId)))
      .orderBy(desc(encounters.updatedAt)).limit(1);
    if (input.decision === "add") {
      if (!visit) throw new ORPCError("NOT_FOUND", { message: "No visit to add the medicine to" });
      const { patient } = await visitOf(db, hospitalId, visit.id);
      const { revision, state } = await loadEncounter(db, hospitalId, visit.id);
      const from = `From a patient photo in Sona Care${message.attachment.key ? ` (${message.attachment.key})` : ""}`;
      await editEncounter(context, hospitalId, { encounterId: visit.id, expectedRevision: revision,
        medicationEntries: mergeMedicines(state.medicationEntries ?? defaultMedications(patient), [{ ...reading, change: "new", confidence: "high" }], from) });
    } else {
      const language = (await lastDischarge(db, hospitalId, message.patientId))?.language;
      const say = DECLINED[language === "ms" || language === "zh" ? language : "en"];
      await db.insert(careMessages).values({ id: `${message.id}:declined`, hospitalId, patientId: message.patientId, from: "care-team", authorId: context.session.user.id, text: say(photoLabel(reading)), createdAt: clockOf(context) })
        .onConflictDoNothing();
      await tellPatient(context, hospitalId, message.patientId, { kind: "reply" });
    }
    const decision = { status: input.decision === "add" ? "added" as const : "declined" as const, reading, by: context.session.user.id, at: clockOf(context).toISOString() };
    await db.update(careMessages).set({ attachment: { ...message.attachment, decision } satisfies MessageAttachment }).where(eq(careMessages.id, message.id));
    await markSeen(context, message.patientId);
    if (message.taskId) await db.update(tasks).set({ completed: true }).where(eq(tasks.id, message.taskId));
    // The middleware announces this write without a patient; Sona Care and the visit hear it here.
    await context.announce?.(hospitalId, { topic: "messages", patientId: message.patientId }).catch(() => {});
    if (visit && input.decision === "add") await context.announce?.(hospitalId, { topic: "visit", encounterId: visit.id }).catch(() => {});
    return decision;
  }),
};
