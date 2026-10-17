import { careLinkOf } from "@sona-ai/api/routers/hospital";
import type { Context as HonoContext } from "hono";

import { createAuth, getDb } from "../services";

/**
 * Sona Care's own agents (the live call, the chat): one per patient, named here from the signed-in session, never by the
 * app. The name is the patient, so every agent of hers is found under the same one.
 */
export const nameOf = (link: { hospitalId: string; patientId: string }) => `${encodeURIComponent(link.hospitalId)}/${encodeURIComponent(link.patientId)}`;
export function patientOf(name: string) {
  const [hospitalId = "", patientId = ""] = name.split("/").map(decodeURIComponent);
  return { hospitalId, patientId };
}

/**
 * For a route shaped as the SDK's own, /agents/<agent>/:id, where `:id` is the signed-in account's user id: that account's
 * patient, or the refusal to send. A path naming another account is refused. It signs in as /live and the RPC client do:
 * the session cookie on the request.
 */
export async function patientLink(c: HonoContext) {
  const db = getDb();
  const session = await (await createAuth(db)).api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.text("Sign in first", 401);
  if (c.req.param("id") !== session.user.id) return c.text("This is another account's conversation", 403);
  const link = await careLinkOf(db, session.user.id);
  if (!link) return c.text("Join with the code on your discharge paper first", 403);
  return link;
}
