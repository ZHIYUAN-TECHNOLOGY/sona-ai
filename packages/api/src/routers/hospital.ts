import { ORPCError } from "@orpc/server";
import { careLinks, hospitalMembers } from "@sona-ai/db/schema/clinical";
import { DEMO_HOSPITAL } from "@sona-ai/db/demo";
import { eq } from "drizzle-orm";

import type { Context } from "../context";

/**
 * The hospital a signed-in user works for, from their membership row.
 * ponytail: a user with no membership joins the demo hospital on first use, which is only right
 * while every hospital holds synthetic data; production assigns members through an admin step.
 */
export async function hospitalOf(db: Context["db"], userId: string) {
  const [member] = await db.select({ hospitalId: hospitalMembers.hospitalId }).from(hospitalMembers).where(eq(hospitalMembers.userId, userId));
  if (member) return member.hospitalId;
  // A Sona Care (patient) account never becomes a clinician, whichever route or socket asks.
  if (await careLinkOf(db, userId)) throw new ORPCError("FORBIDDEN", { message: "This is a Sona Care account" });
  await db.insert(hospitalMembers).values({ userId, hospitalId: DEMO_HOSPITAL }).onConflictDoNothing();
  return DEMO_HOSPITAL;
}

/** An approval names the signed-in doctor or nobody; a blank name is left for the domain guard to refuse. */
export function assertApprover(userId: string, approvedBy: string) {
  if (approvedBy.trim() && approvedBy !== userId) throw new ORPCError("FORBIDDEN", { message: "You can only approve in your own name" });
}

/** The patient record a Sona Care account is linked to, if it is one. */
export async function careLinkOf(db: Context["db"], userId: string) {
  const [link] = await db.select().from(careLinks).where(eq(careLinks.userId, userId));
  return link;
}
