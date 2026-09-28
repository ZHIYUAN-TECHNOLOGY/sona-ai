import { ORPCError } from "@orpc/server";
import { appointments, bookingRequests, careMessages, doctors, encounters, patients, tasks } from "@sona-ai/db/schema/clinical";
import { clinicSlots, shortName, slotWords } from "@sona-ai/domain/doctors";
import { and, asc, desc, eq, gte, inArray, isNotNull, type SQL } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { patientProcedure, protectedProcedure } from "../index";
import { tellPatient } from "../push";

/**
 * Real booking. Patients find a doctor (the hospital's directory, SYNTHETIC in the demo) and request a
 * clinic slot; the request is one task for the care team on My Day, who confirm it (it becomes an
 * appointment on the patient's Schedule) or decline it with a note (sent to the patient's thread).
 * A slot is free when none of that doctor's appointments starts then and no open or confirmed request
 * holds it for them; another doctor's appointment at the same time does not block it.
 */
type Db = Context["db"];
type DoctorRow = typeof doctors.$inferSelect;

const doctorsAt = (db: Db, hospitalId: string, where?: SQL) =>
  db.select().from(doctors).where(and(eq(doctors.hospitalId, hospitalId), where)).orderBy(asc(doctors.name));

/** Each doctor with their free slots over the next two weeks, grouped by clinic day (days with none left are dropped). */
export async function withSlots(db: Db, hospitalId: string, list: DoctorRow[], now: Date) {
  // An appointment with no doctor (a recall, a seeded clinic visit) holds nobody's slot.
  const [booked, held] = await Promise.all([
    db.select({ doctorId: appointments.doctorId, at: appointments.startsAt }).from(appointments)
      .where(and(eq(appointments.hospitalId, hospitalId), gte(appointments.startsAt, now), isNotNull(appointments.doctorId))),
    db.select({ doctorId: bookingRequests.doctorId, at: bookingRequests.startsAt }).from(bookingRequests)
      .where(and(eq(bookingRequests.hospitalId, hospitalId), inArray(bookingRequests.status, ["requested", "confirmed"]), gte(bookingRequests.startsAt, now))),
  ]);
  return list.map(d => {
    const mine = new Set([...booked, ...held].filter(h => h.doctorId === d.id).map(h => h.at.getTime()));
    const nextSlots = clinicSlots(d, now).map(day => ({ day: day.day, times: day.times.filter(t => !mine.has(t.getTime())) }))
      .filter(day => day.times.length);
    return { ...d, nextSlots };
  });
}

/** Booking requests with who, whom and when; a declined one carries the care team's note. */
async function listRequests(db: Db, hospitalId: string, where: SQL) {
  const rows = await db.select({
    id: bookingRequests.id, patientId: bookingRequests.patientId, patientName: patients.name, doctorId: bookingRequests.doctorId, doctorName: doctors.name,
    specialty: doctors.specialty, room: doctors.room, startsAt: bookingRequests.startsAt, reason: bookingRequests.reason, status: bookingRequests.status,
    taskId: bookingRequests.taskId, title: tasks.title, appointmentId: bookingRequests.appointmentId, createdAt: bookingRequests.createdAt, decidedAt: bookingRequests.decidedAt,
  }).from(bookingRequests).innerJoin(doctors, eq(doctors.id, bookingRequests.doctorId)).innerJoin(patients, eq(patients.id, bookingRequests.patientId))
    .leftJoin(tasks, eq(tasks.id, bookingRequests.taskId))
    .where(and(eq(bookingRequests.hospitalId, hospitalId), where)).orderBy(asc(bookingRequests.startsAt));
  const notes = rows.some(r => r.status === "declined")
    ? await db.select({ id: careMessages.id, text: careMessages.text }).from(careMessages).where(inArray(careMessages.id, rows.map(r => noteId(r.id)))) : [];
  return rows.map(r => ({ ...r, note: notes.find(n => n.id === noteId(r.id))?.text ?? null }));
}
// The decline note is a care-team message in the patient's thread, keyed by the request (no note column needed).
const noteId = (requestId: string) => `booking-note:${requestId}`;

const requestInput = z.object({ doctorId: z.string().min(1), startsAt: z.coerce.date(), reason: z.string().trim().max(200).optional() });

/** Patient side, under care.doctors and care.bookings. */
export const careDoctorsRouter = {
  list: patientProcedure.handler(async ({ context }) => withSlots(context.db, context.hospitalId, await doctorsAt(context.db, context.hospitalId), clockOf(context))),
  get: patientProcedure.input(z.object({ id: z.string().min(1) })).handler(async ({ context, input }) => {
    const [doctor] = await withSlots(context.db, context.hospitalId, await doctorsAt(context.db, context.hospitalId, eq(doctors.id, input.id)), clockOf(context));
    if (!doctor) throw new ORPCError("NOT_FOUND", { message: "We couldn't find that doctor" });
    return doctor;
  }),
};

export const careBookingsRouter = {
  list: patientProcedure.handler(({ context }) => listRequests(context.db, context.hospitalId, eq(bookingRequests.patientId, context.patientId))),
  /**
   * One request per patient, doctor and slot (a replay returns it); the slot must still be free. It is
   * a task for the care team on the patient's latest visit ("Amelia asks to see Dr. Lim · Thu 10:30").
   */
  request: patientProcedure.input(requestInput).handler(async ({ context, input }) => {
    const { db, hospitalId, patientId } = context, now = clockOf(context);
    const [doctor] = await withSlots(db, hospitalId, await doctorsAt(db, hospitalId, eq(doctors.id, input.doctorId)), now);
    if (!doctor) throw new ORPCError("NOT_FOUND", { message: "We couldn't find that doctor" });
    const id = `booking:${patientId}:${doctor.id}:${input.startsAt.getTime()}`;
    const [existing] = await db.select({ id: bookingRequests.id }).from(bookingRequests).where(eq(bookingRequests.id, id));
    if (!existing) {
      if (!doctor.nextSlots.some(d => d.times.some(t => t.getTime() === input.startsAt.getTime())))
        throw new ORPCError("CONFLICT", { message: "That time is no longer free. Please choose another." });
      const [patient] = await db.select({ name: patients.name, encounterId: encounters.id }).from(patients)
        .leftJoin(encounters, eq(encounters.patientId, patients.id)).where(eq(patients.id, patientId)).orderBy(desc(encounters.updatedAt)).limit(1);
      const words = slotWords(input.startsAt);
      await db.insert(tasks).values({
        id, hospitalId, encounterId: patient!.encounterId, kind: "booking", title: `${patient!.name.split(" ")[0]} asks to see ${shortName(doctor.name)} · ${words.weekday} ${words.time}`,
        owner: "Care team", due: "Today", sourceId: id, idempotencyKey: id,
      }).onConflictDoNothing();
      await db.insert(bookingRequests).values({ id, hospitalId, patientId, doctorId: doctor.id, startsAt: input.startsAt, reason: input.reason || null, taskId: id, createdAt: now })
        .onConflictDoNothing();
    }
    return (await listRequests(db, hospitalId, eq(bookingRequests.id, id)))[0]!;
  }),
};

/** Clinician side: the care-team doctors' free slots (Book in), open requests, and the decision. */
export const bookingsRouter = {
  /** A doctor's free slots (the first care-team doctor by default) and the care team to choose from. */
  slots: protectedProcedure.input(z.object({ doctorId: z.string().min(1).optional() }).optional()).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    const team = await doctorsAt(db, hospitalId, eq(doctors.careTeam, true));
    const [doctor] = input?.doctorId ? await doctorsAt(db, hospitalId, eq(doctors.id, input.doctorId)) : team;
    if (!doctor) throw new ORPCError("NOT_FOUND", { message: "No such doctor at this hospital" });
    const [free] = await withSlots(db, hospitalId, [doctor], clockOf(context));
    return { doctor: { id: doctor.id, name: doctor.name, specialty: doctor.specialty }, careTeam: team.map(d => ({ id: d.id, name: d.name, specialty: d.specialty })), days: free!.nextSlots };
  }),
  list: protectedProcedure.handler(({ context }) => listRequests(context.db, context.hospitalId, eq(bookingRequests.status, "requested"))),
  /**
   * Confirm books the visit ("Visit: Dr. Lim, Respiratory") on the patient's Schedule; decline sends the
   * note to their thread. Either closes the task. A request already decided is returned as it is.
   */
  decide: protectedProcedure.input(z.object({ requestId: z.string().min(1), decision: z.enum(["confirm", "decline"]), note: z.string().trim().max(500).optional() }))
    .handler(async ({ context, input }) => {
      const { db, hospitalId } = context, now = clockOf(context);
      const [row] = await listRequests(db, hospitalId, eq(bookingRequests.id, input.requestId));
      if (!row) throw new ORPCError("NOT_FOUND", { message: "That request is no longer open" });
      if (row.status === "requested") {
        const open = and(eq(bookingRequests.id, row.id), eq(bookingRequests.status, "requested"));
        if (input.decision === "confirm") {
          const appointmentId = `visit:${row.id}`;
          await db.insert(appointments).values({ id: appointmentId, patientId: row.patientId, hospitalId, doctorId: row.doctorId, startsAt: row.startsAt, kind: `Visit: ${shortName(row.doctorName)}, ${row.specialty}` })
            .onConflictDoNothing();
          await db.update(bookingRequests).set({ status: "confirmed", appointmentId, decidedAt: now }).where(open);
        } else {
          const w = slotWords(row.startsAt);
          const text = input.note || `Sorry, ${shortName(row.doctorName)} can't see you on ${w.day} at ${w.time}. Please choose another time.`;
          await db.insert(careMessages).values({ id: noteId(row.id), hospitalId, patientId: row.patientId, from: "care-team", authorId: context.session.user.id, text, createdAt: now })
            .onConflictDoNothing();
          await db.update(bookingRequests).set({ status: "declined", decidedAt: now }).where(open);
        }
        if (row.taskId) await db.update(tasks).set({ completed: true }).where(eq(tasks.id, row.taskId));
        await tellPatient(context, hospitalId, row.patientId, { kind: input.decision === "confirm" ? "confirmed" : "declined", doctor: shortName(row.doctorName), at: row.startsAt });
      }
      // The hospital hears "bookings" from the middleware; the patient's Sona Care hears it here.
      await context.announce?.(hospitalId, { topic: "bookings", patientId: row.patientId }).catch(() => {});
      return (await listRequests(db, hospitalId, eq(bookingRequests.id, row.id)))[0]!;
    }),
};
