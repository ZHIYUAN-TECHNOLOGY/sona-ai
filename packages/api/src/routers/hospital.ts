import { hospitalMembers } from "@sona-ai/db/schema/clinical";
import { DEMO_HOSPITAL } from "@sona-ai/db/seed";
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
  await db.insert(hospitalMembers).values({ userId, hospitalId: DEMO_HOSPITAL }).onConflictDoNothing();
  return DEMO_HOSPITAL;
}
