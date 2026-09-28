import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";
import { changeFor } from "./events";
import { clockOffsetOf, shifted } from "./clock";
import { recordAccess } from "./access";
import { careLinkOf, memberOf } from "./routers/hospital";
import { refusal } from "./roles";

export const o = os.$context<Context>();

export const publicProcedure = o;

export const requireAuth = o.middleware(async ({ context, next, path }, input) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  // Every clinical read and write below is scoped to this hospital (a Sona Care account is refused there).
  const { hospitalId, role } = await memberOf(context.db, context.session.user);
  // The role's permission, from the one table in ./roles (a route missing from it is refused for everyone).
  const route = path.join(".");
  const refused = refusal(role, route);
  if (refused) throw new ORPCError("FORBIDDEN", { message: refused, data: { role } });
  // The hospital's demo clock (0 is real time), so every route's clockOf agrees.
  const now = shifted(context.now, await clockOffsetOf(context.db, hospitalId));
  const result = await next({ context: { session: context.session, hospitalId, role, now } });
  // PDPA access trail: a call naming a patient or visit is logged; a failed log never fails the call.
  // Reading the trail itself is not an access to the record.
  if (route !== "accessLog.list") await recordAccess({ db: context.db, now }, hospitalId, context.session.user.id, route, input).catch(() => {});
  // A write that succeeded is announced to the hospital's connected apps; a failed announcement never fails the write.
  const change = changeFor(path, input);
  if (change && context.announce) await context.announce(hospitalId, change).catch(() => {});
  return result;
});

export const protectedProcedure = publicProcedure.use(requireAuth);

/** Any signed-in account, before it is a clinician or a patient (Sona Care's join step). */
export const signedInProcedure = publicProcedure.use(async ({ context, next }) => {
  if (!context.session?.user) throw new ORPCError("UNAUTHORIZED");
  return next({ context: { session: context.session } });
});

/**
 * Sona Care: a patient's account, linked to exactly one patient record. Every route under it reads
 * and writes that patient only; writes are announced like clinical ones (care.checkIns.reply is a
 * "checkIns" change to the hospital's clinicians).
 */
export const patientProcedure = publicProcedure.use(async ({ context, next, path }, input) => {
  if (!context.session?.user) throw new ORPCError("UNAUTHORIZED");
  const link = await careLinkOf(context.db, context.session.user.id);
  if (!link) throw new ORPCError("FORBIDDEN", { message: "Join with the code on your discharge paper first" });
  const now = shifted(context.now, await clockOffsetOf(context.db, link.hospitalId));
  const result = await next({ context: { session: context.session, hospitalId: link.hospitalId, patientId: link.patientId, now } });
  const change = changeFor(path.slice(1), input);
  if (change && context.announce) await context.announce(link.hospitalId, { ...change, patientId: link.patientId }).catch(() => {});
  return result;
});
