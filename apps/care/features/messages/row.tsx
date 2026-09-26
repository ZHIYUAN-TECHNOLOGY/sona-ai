import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { useMe } from "@/features/me";
import { Row } from "@/lib/ui";
import { orpc } from "@/utils/orpc";
import { unreadReply } from "./model";

/**
 * The care team thread's home row: says when a reply is waiting. What this phone has read is kept
 * on the phone (the last message shown), read through useSyncExternalStore so React Compiler never
 * caches a stale module read.
 */
const KEY = "sona-care.messages.lastRead";
let lastRead: string | undefined;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
SecureStore.getItemAsync(KEY).then(v => { if (v && !lastRead) { lastRead = v; listeners.forEach(l => l()); } }).catch(() => {});

export function markRead(id: string) {
  if (id === lastRead) return;
  lastRead = id;
  listeners.forEach(l => l());
  SecureStore.setItemAsync(KEY, id).catch(() => {});
}

/** The thread; the messages screen passes a refetch interval while it is open (patients have no live socket). */
export function useThread(refetchInterval?: number) {
  const { state } = useMe();
  return useQuery({ ...orpc.care.messages.list.queryOptions(), enabled: state === "joined", refetchInterval });
}

export function useMessageNeeds() {
  const { data } = useThread();
  const read = useSyncExternalStore(subscribe, () => lastRead);
  return data && unreadReply(data, read) ? 1 : 0;
}

export function CareTeamRow({ first }: { first?: boolean }) {
  const waiting = useMessageNeeds();
  return <Row first={first} title="Message my care team" line={waiting ? "New reply from your care team" : "Not for emergencies · call 999"} tone={waiting ? "green" : "muted"}
    onPress={() => router.push("/messages")} />;
}
