import { ORPCError } from "@orpc/server";
import { DEMO_HOSPITAL } from "@sona-ai/db/demo";
import { encounters, hospitals } from "@sona-ai/db/schema/clinical";
import { checkInSchedule } from "@sona-ai/domain/check-ins";
import { FOLLOW_UPS, type DischargeState } from "@sona-ai/domain/discharge";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { clockOffsetOf } from "../clock";
import { clockOf, type Context } from "../context";
import { protectedProcedure } from "../index";
import { sendDueCheckIns } from "./check-ins";

/**
 * The demo clock's controls: jump the demo hospital to the day-2 check-in, day 7 or the clinic
 * review, and back to real time. The clock itself (the offset every route reads) is in ../clock.
 */
const MINUTE = 60_000;
export const JUMPS = ["now", "day-1", "day-2", "day-7", "visit"] as const;
export type Jump = (typeof JUMPS)[number];

/** Where each jump lands, from the hospital's latest discharge: just after each check-in is due, and 09:00 on the review day. */
export async function jumpTargets(db: Context["db"], hospitalId: string) {
  const rows = await db.select({ state: encounters.state }).from(encounters).where(eq(encounters.hospitalId, hospitalId));
  const last = rows.map(r => (r.state as { discharge?: DischargeState }).discharge)
    .filter((d): d is DischargeState & { dischargedAt: string } => Boolean(d?.dischargedAt))
    .sort((a, b) => b.dischargedAt.localeCompare(a.dischargedAt))[0];
  if (!last) return undefined;
  const out = new Date(last.dischargedAt);
  const due = Object.fromEntries(checkInSchedule(out).map(c => [c.day, c.dueAt]));
  const days = FOLLOW_UPS.find(f => f.id === last.followUp)?.days;
  // 09:00 in Kuala Lumpur (01:00 UTC) on the review day.
  const visit = days === undefined ? undefined : new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth(), out.getUTCDate() + days, 1));
  // Day 1 at 08:05 in Kuala Lumpur (00:05 UTC): the morning dose is due, so the patient can take it on screen.
  const day1 = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth(), out.getUTCDate() + (out.getUTCHours() >= 16 ? 2 : 1), 0, 5));
  return {
    dischargedAt: out,
    "day-1": day1,
    "day-2": due[2] && new Date(due[2].getTime() + MINUTE),
    "day-7": due[7] && new Date(due[7].getTime() + MINUTE),
    visit,
  } as { dischargedAt: Date } & Partial<Record<Exclude<Jump, "now">, Date>>;
}

async function status(db: Context["db"], hospitalId: string, now: Date) {
  const offsetMs = await clockOffsetOf(db, hospitalId);
  const targets = await jumpTargets(db, hospitalId);
  return {
    offsetMs, now,
    dischargedAt: targets?.dischargedAt ?? null,
    available: JUMPS.filter(j => j === "now" || Boolean(targets?.[j])),
  };
}

export const demoRouter = {
  /** The demo clock and which jumps the latest discharge allows. */
  status: protectedProcedure.handler(({ context }) => status(context.db, context.hospitalId, clockOf(context))),
  /**
   * Moves the demo hospital's clock (announced as a "demo" change, so every connected app re-reads),
   * then sends whatever check-ins are now due, as the hourly cron would have.
   */
  jump: protectedProcedure.input(z.object({ to: z.enum(JUMPS) })).handler(async ({ context, input }) => {
    const { db, hospitalId } = context;
    if (hospitalId !== DEMO_HOSPITAL) throw new ORPCError("FORBIDDEN", { message: "Only the demo hospital has a demo clock" });
    // Real time is the request's clock without the current offset (a test's fixed clock in tests).
    const real = clockOf(context).getTime() - await clockOffsetOf(db, hospitalId);
    let offset = 0;
    if (input.to !== "now") {
      const at = (await jumpTargets(db, hospitalId))?.[input.to];
      if (!at) throw new ORPCError("BAD_REQUEST", { message: "Discharge a patient first; the jumps count from their discharge" });
      offset = at.getTime() - real;
    }
    await db.update(hospitals).set({ clockOffsetMs: offset }).where(eq(hospitals.id, hospitalId));
    const now = new Date(real + offset);
    await sendDueCheckIns(db, hospitalId, now);
    return status(db, hospitalId, now);
  }),
};
