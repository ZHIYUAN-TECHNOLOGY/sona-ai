import { ORPCError } from "@orpc/server";
import { appointments, encounters, handoverAcceptances, labResults, observations, patients, tasks } from "@sona-ai/db/schema/clinical";
import { buildHandover, type HandoverPatient } from "@sona-ai/domain/handover";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { handoverAcceptSchema } from "../contracts";
import type { Context } from "../context";
import { protectedProcedure } from "../index";

// The demo hospital's wall clock (Malaysia); the Worker runs in UTC.
const clock = (at: Date) => at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
const label = (kind: string) => kind[0]!.toUpperCase() + kind.slice(1).replace(/-/g, " ");

/** SBAR cards for the hospital's patients, from its rows: observations, flagged results, open tasks, the note's review. */
export async function handoverCards(db: Context["db"], hospitalId: string) {
  const people = await db.select().from(patients).where(eq(patients.hospitalId, hospitalId));
  const ids = people.map(p => p.id);
  if (!ids.length) return [];
  const [visits, obs, labs, open, appts] = await Promise.all([
    db.select().from(encounters).where(eq(encounters.hospitalId, hospitalId)),
    db.select().from(observations).where(inArray(observations.patientId, ids)),
    db.select().from(labResults).where(and(inArray(labResults.patientId, ids), isNotNull(labResults.flag))),
    db.select().from(tasks).where(and(eq(tasks.hospitalId, hospitalId), eq(tasks.completed, false))),
    db.select().from(appointments).where(eq(appointments.hospitalId, hospitalId)),
  ]);
  const rows: HandoverPatient[] = people.map(p => {
    const vitals = obs.filter(o => o.patientId === p.id).map(o => ({ label: label(o.kind), value: o.unit === "flag" ? (o.value ? "present" : "absent") : `${o.value} ${o.unit}` }));
    const appt = appts.find(a => a.patientId === p.id);
    return {
      id: p.id, name: p.name, age: p.age, sex: p.sex, complaint: p.complaint, allergies: p.allergies, incomplete: p.incomplete,
      time: appt ? clock(appt.startsAt) : "not booked", history: [], medicines: [], vitals,
      sources: vitals.length ? [{ id: "vitals", title: "Observations", date: "", kind: "record", excerpt: "", synthetic: true }] : [],
    };
  });
  const byPatient = Object.fromEntries(people.map(p => {
    const visit = visits.find(v => v.patientId === p.id);
    const state = (visit?.state ?? {}) as { noteReviewed?: boolean };
    return [p.id, { noteReviewed: state.noteReviewed, tasks: open.filter(t => visit && t.encounterId === visit.id).map(t => ({ title: t.title, due: t.due ?? undefined, completed: t.completed })) }];
  }));
  const pending = labs.map(l => ({ patientId: l.patientId, test: l.test, value: [l.value, l.unit].filter(Boolean).join(" "), flag: l.flag!, receivedAt: clock(l.receivedAt) }));
  return buildHandover(rows, byPatient, pending);
}

export const handoverRouter = {
  list: protectedProcedure.handler(({ context: { db, hospitalId } }) => handoverCards(db, hospitalId)),
  accept: protectedProcedure.input(handoverAcceptSchema).handler(async ({ context: { db, hospitalId, session }, input }) => {
    const known = new Set((await handoverCards(db, hospitalId)).map(c => c.id));
    const missing = input.cardIds.filter(id => !known.has(id));
    if (missing.length) throw new ORPCError("NOT_FOUND", { message: `No handover card ${missing.join(", ")}` });
    await db.insert(handoverAcceptances)
      .values({ id: crypto.randomUUID(), hospitalId, fromUser: session.user.id, toUser: input.toUser, cardIds: input.cardIds, requestId: input.requestId })
      .onConflictDoNothing({ target: handoverAcceptances.requestId });
    const [row] = await db.select().from(handoverAcceptances).where(and(eq(handoverAcceptances.requestId, input.requestId), eq(handoverAcceptances.hospitalId, hospitalId)));
    if (!row) throw new ORPCError("CONFLICT", { message: `Request ${input.requestId} was used elsewhere` });
    return row;
  }),
};
