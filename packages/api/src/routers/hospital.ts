import { ORPCError } from "@orpc/server";
import { careLinks, hospitalMembers, hospitals } from "@sona-ai/db/schema/clinical";
import { DEMO_CLINICIANS, DEMO_HOSPITAL } from "@sona-ai/db/demo";
import { eq } from "drizzle-orm";

import { clockOffsetOf } from "../clock";
import type { Context } from "../context";

/**
 * The hospital a signed-in clinician works for, and their role, from their membership row. Nobody
 * becomes a clinician by signing in: only an existing member, or a seeded demo account on first use
 * (with its role from DEMO_CLINICIANS). Everyone else (a Sona Care patient, a phone or Apple sign-up
 * that never joined) is refused, whichever route or socket asks. The hospital's demo clock comes in the
 * same read, since every clinician call needs all three.
 */
export async function memberOf(db: Context["db"], user: { id: string; email: string }) {
  const [member] = await db.select({ hospitalId: hospitalMembers.hospitalId, role: hospitalMembers.role, clockOffsetMs: hospitals.clockOffsetMs })
    .from(hospitalMembers).innerJoin(hospitals, eq(hospitals.id, hospitalMembers.hospitalId)).where(eq(hospitalMembers.userId, user.id));
  if (member) return member;
  if (await careLinkOf(db, user.id)) throw new ORPCError("FORBIDDEN", { message: "This is a Sona Care account" });
  const role = DEMO_CLINICIANS[user.email.toLowerCase()];
  if (!role) throw new ORPCError("FORBIDDEN", { message: "This account is not a clinician at any hospital" });
  await db.insert(hospitalMembers).values({ userId: user.id, hospitalId: DEMO_HOSPITAL, role }).onConflictDoNothing();
  return { hospitalId: DEMO_HOSPITAL, role, clockOffsetMs: await clockOffsetOf(db, DEMO_HOSPITAL) };
}

export const hospitalOf = async (db: Context["db"], user: { id: string; email: string }) => (await memberOf(db, user)).hospitalId;

/** An approval names the signed-in doctor or nobody; a blank name is left for the domain guard to refuse. */
export function assertApprover(userId: string, approvedBy: string) {
  if (approvedBy.trim() && approvedBy !== userId) throw new ORPCError("FORBIDDEN", { message: "You can only approve in your own name" });
}

/** The patient record a Sona Care account is linked to, if it is one, with its hospital's demo clock. */
export async function careLinkOf(db: Context["db"], userId: string) {
  const [row] = await db.select({ link: careLinks, clockOffsetMs: hospitals.clockOffsetMs }).from(careLinks)
    .leftJoin(hospitals, eq(hospitals.id, careLinks.hospitalId)).where(eq(careLinks.userId, userId));
  return row && { ...row.link, clockOffsetMs: row.clockOffsetMs ?? 0 };
}
