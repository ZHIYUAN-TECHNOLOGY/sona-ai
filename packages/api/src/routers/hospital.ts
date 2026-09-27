import { ORPCError } from "@orpc/server";
import { careLinks, hospitalMembers } from "@sona-ai/db/schema/clinical";
import { DEMO_CLINICIANS, DEMO_HOSPITAL } from "@sona-ai/db/demo";
import { eq } from "drizzle-orm";

import type { Context } from "../context";

/**
 * The hospital a signed-in clinician works for, from their membership row. Nobody becomes a clinician
 * by signing in: only an existing member, or the seeded demo clinician on first use. Everyone else
 * (a Sona Care patient, a phone or Apple sign-up that never joined) is refused, whichever route or
 * socket asks.
 */
export async function hospitalOf(db: Context["db"], user: { id: string; email: string }) {
  const [member] = await db.select({ hospitalId: hospitalMembers.hospitalId }).from(hospitalMembers).where(eq(hospitalMembers.userId, user.id));
  if (member) return member.hospitalId;
  if (await careLinkOf(db, user.id)) throw new ORPCError("FORBIDDEN", { message: "This is a Sona Care account" });
  if (!DEMO_CLINICIANS.includes(user.email.toLowerCase())) throw new ORPCError("FORBIDDEN", { message: "This account is not a clinician at any hospital" });
  await db.insert(hospitalMembers).values({ userId: user.id, hospitalId: DEMO_HOSPITAL }).onConflictDoNothing();
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
