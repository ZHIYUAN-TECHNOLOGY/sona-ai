import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

/**
 * Who is using Sona Care: signed out, signed in but not joined yet (no record linked), or a joined
 * patient with their record. Every patient screen reads through this.
 */
export function useMe() {
  const { data: session, isPending } = authClient.useSession();
  const me = useQuery({ ...orpc.care.me.queryOptions(), enabled: Boolean(session?.user), retry: false });
  const state = isPending || (session?.user && me.isLoading) ? "loading" : !session?.user ? "signed-out" : me.data ? "joined" : "not-joined";
  return { state, me: me.data, refresh: () => me.refetch() } as const;
}
