import { ORPCError } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

/** The hospital's name as the patient reads it: the demo's "(synthetic)" suffix goes, since the home pill says it once. */
export const hospitalName = (name: string) => name.replace(/\s*\(synthetic\)\s*$/i, "");

/** The server answered and refused (not joined, no record, signed out), as opposed to not answering or failing. */
const refused = (e: unknown) => e instanceof ORPCError && e.status < 500;

/**
 * Who is using Sona Care: signed out, signed in but not joined yet (no record linked), or a joined
 * patient with their record. Every patient screen reads through this.
 */
export function useMe() {
  const { data: session, isPending } = authClient.useSession();
  // A refusal (no record linked) is the answer at once; an unreachable server is tried again, backing off, until it answers.
  const me = useQuery({ ...orpc.care.me.queryOptions(), enabled: Boolean(session?.user), retry: (_, e) => !refused(e), select: d => d && { ...d, hospital: hospitalName(d.hospital) } });
  // Not joined only when the server said so. A dropped connection used to read as "not joined": Home mounted, its new
  // observer re-read the record, which put the state back to loading and unmounted Home, about 20 times a second.
  const state = isPending || (session?.user && !me.data && !refused(me.error)) ? "loading" : !session?.user ? "signed-out" : me.data ? "joined" : "not-joined";
  // While loading: still checking the session, or signed in and fetching the record.
  return { state, step: isPending ? "session" : "record", me: me.data, refresh: () => me.refetch() } as const;
}
