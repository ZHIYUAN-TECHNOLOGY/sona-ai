import { useQuery } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { useMe } from "@/features/me";
import { orpc } from "@/utils/orpc";
import { unreadReply } from "./model";

/**
 * The care team thread and whether a reply is waiting. What this phone has read is kept
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

/** The thread; the live socket (features/live) re-reads it when the care team writes or opens it, so nothing polls. */
export function useThread() {
  const { state } = useMe();
  return useQuery({ ...orpc.care.messages.list.queryOptions(), enabled: state === "joined" });
}

export function useMessageNeeds() {
  const { data } = useThread();
  const read = useSyncExternalStore(subscribe, () => lastRead);
  return data && unreadReply(data, read) ? 1 : 0;
}
