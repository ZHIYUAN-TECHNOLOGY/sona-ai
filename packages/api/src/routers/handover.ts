import { ORPCError } from "@orpc/server";
import { appointments, encounters, findings, handoverAcceptances, hospitalMembers, labResults, observations, patients, tasks } from "@sona-ai/db/schema/clinical";
import { user } from "@sona-ai/db/schema/auth";
import { elapsed } from "@sona-ai/domain/critical";
import { findingLine } from "@sona-ai/domain/findings";
import { buildHandover, type HandoverPatient } from "@sona-ai/domain/handover";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";

import { handoverAcceptSchema } from "../contracts";
import { clockOf, type Context } from "../context";
import { protectedProcedure } from "../index";
import { PERMISSIONS } from "../roles";
import { listFindings } from "./findings";

// The demo hospital's wall clock (Malaysia); the Worker runs in UTC.
const clock = (at: Date) => at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
const day = (at: Date) => at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" });
/** When a result came in, for a card's "received …": the time, with the date once that is not today ("09:47 on 4 Oct"). */
const received = (at: Date, now: Date) => day(at) === day(now) ? clock(at) : `${clock(at)} on ${day(at)}`;
const label = (kind: string) => kind[0]!.toUpperCase() + kind.slice(1).replace(/-/g, " ");

/**
 * SBAR cards for the hospital's patients, from its rows: observations, flagged results, open tasks, the note's review.
 * A patient whose visit is discharged has left the ward and is nobody's to hand over, so they have no card, unless a
 * result of theirs still waits on a doctor: that must not leave the shift unseen. `now` is the hospital's clock.
 */
export async function handoverCards(db: Context["db"], hospitalId: string, now: Date) {
  const people = await db.select().from(patients).where(eq(patients.hospitalId, hospitalId));
  const ids = people.map(p => p.id);
  if (!ids.length) return [];
  // A result still pending at the lab (it holds a bed on the ward) has nothing to act on yet.
  const [visits, obs, labs, open, appts, found] = await Promise.all([
    db.select().from(encounters).where(eq(encounters.hospitalId, hospitalId)),
    db.select().from(observations).where(inArray(observations.patientId, ids)),
    db.select({ lab: labResults, by: user.name }).from(labResults).leftJoin(user, eq(user.id, labResults.acknowledgedBy)).where(and(inArray(labResults.patientId, ids), isNotNull(labResults.flag), ne(labResults.flag, "pending"))),
    db.select().from(tasks).where(and(eq(tasks.hospitalId, hospitalId), eq(tasks.completed, false))),
    db.select().from(appointments).where(eq(appointments.hospitalId, hospitalId)),
    listFindings(db, hospitalId, new Date(), ne(findings.status, "dismissed")), // lane F6
  ]);
  // Only results nobody has acknowledged are still to act on.
  const waiting = labs.filter(({ lab }) => !lab.acknowledgedAt).map(({ lab }) => lab);
  const discharged = (patientId: string) => Boolean((visits.find(v => v.patientId === patientId)?.state as { discharge?: { dischargedAt?: string } } | undefined)?.discharge?.dischargedAt);
  const onShift = people.filter(p => !discharged(p.id) || waiting.some(l => l.patientId === p.id));
  const rows: HandoverPatient[] = onShift.map(p => {
    const vitals = obs.filter(o => o.patientId === p.id).map(o => ({ label: label(o.kind), value: o.unit === "AMT" ? `AMT ${o.value}/10` : `${o.value} ${o.unit}` }));
    const appt = appts.find(a => a.patientId === p.id);
    return {
      id: p.id, name: p.name, age: p.age, sex: p.sex, complaint: p.complaint, allergies: p.allergies, incomplete: p.incomplete,
      time: appt ? clock(appt.startsAt) : "not booked", history: [], medicines: [], vitals,
      sources: vitals.length ? [{ id: "vitals", title: "Observations", date: "", kind: "record", excerpt: "", synthetic: true }] : [],
    };
  });
  const byPatient = Object.fromEntries(onShift.map(p => {
    const visit = visits.find(v => v.patientId === p.id);
    const state = (visit?.state ?? {}) as { noteReviewed?: boolean };
    // A finding's own line stands in for its task, so a tracked one is handed over once, with its due date.
    const followUps = found.filter(f => f.patientId === p.id).map(f => ({ title: findingLine(f), completed: false }));
    // A critical result stays in the handover once acted on: who acknowledged it, and how long it waited.
    const acted = labs.filter(({ lab }) => lab.patientId === p.id && lab.acknowledgedAt && lab.flag?.startsWith("critical"))
      .map(({ lab, by }) => ({ title: `Critical ${lab.test.toLowerCase()} ${[lab.value, lab.unit].filter(Boolean).join(" ")} acknowledged by ${by ?? lab.acknowledgedBy} after ${elapsed(lab.receivedAt, lab.acknowledgedAt!)}`, completed: false }));
    return [p.id, { noteReviewed: state.noteReviewed, tasks: [...open.filter(t => visit && t.encounterId === visit.id && t.kind !== "finding").map(t => ({ title: t.title, due: t.due ?? undefined, completed: t.completed })), ...followUps, ...acted] }];
  }));
  const pending = waiting.map(l => ({ patientId: l.patientId, test: l.test, value: [l.value, l.unit].filter(Boolean).join(" "), flag: l.flag!, receivedAt: received(l.receivedAt, now) }));
  return buildHandover(rows, byPatient, pending);
}

/**
 * Who can take a handover: the hospital's own members whose role may accept one (the handover.accept row of
 * the permission table), by their account name. A member appears once they have signed in; nobody is authored.
 */
export const handoverReceivers = (db: Context["db"], hospitalId: string) => db.select({ id: user.id, name: user.name, role: hospitalMembers.role })
  .from(hospitalMembers).innerJoin(user, eq(user.id, hospitalMembers.userId))
  .where(and(eq(hospitalMembers.hospitalId, hospitalId), inArray(hospitalMembers.role, [...PERMISSIONS["handover.accept"]![0]]))).orderBy(user.name);

export const handoverRouter = {
  /** The clinicians the signed-in one can hand over to: everyone who may accept, except themselves. */
  receivers: protectedProcedure.handler(async ({ context: { db, hospitalId, session } }) => (await handoverReceivers(db, hospitalId)).filter(r => r.id !== session.user.id)),
  list: protectedProcedure.handler(({ context }) => handoverCards(context.db, context.hospitalId, clockOf(context))),
  accept: protectedProcedure.input(handoverAcceptSchema).handler(async ({ context, input }) => {
    const { db, hospitalId, session } = context;
    const known = new Set((await handoverCards(db, hospitalId, clockOf(context))).map(c => c.id));
    const missing = input.cardIds.filter(id => !known.has(id));
    if (missing.length) throw new ORPCError("NOT_FOUND", { message: `No handover card ${missing.join(", ")}` });
    // The receiver is a user id, never a typed name: the record names a real colleague at this hospital who may accept.
    if (input.toUser === session.user.id) throw new ORPCError("BAD_REQUEST", { message: "Hand over to a colleague, not to yourself" });
    if (!(await handoverReceivers(db, hospitalId)).some(r => r.id === input.toUser)) throw new ORPCError("BAD_REQUEST", { message: "The receiving clinician is not a doctor or nurse at this hospital" });
    await db.insert(handoverAcceptances)
      .values({ id: crypto.randomUUID(), hospitalId, fromUser: session.user.id, toUser: input.toUser, cardIds: input.cardIds, requestId: input.requestId })
      .onConflictDoNothing({ target: handoverAcceptances.requestId });
    const [row] = await db.select().from(handoverAcceptances).where(and(eq(handoverAcceptances.requestId, input.requestId), eq(handoverAcceptances.hospitalId, hospitalId)));
    if (!row) throw new ORPCError("CONFLICT", { message: `Request ${input.requestId} was used elsewhere` });
    return row;
  }),
};
