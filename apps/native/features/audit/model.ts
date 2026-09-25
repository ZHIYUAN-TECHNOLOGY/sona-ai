import { useSyncExternalStore } from "react";

export * from "@sona-ai/domain/audit";

// A tiny shared store: which queries have gone out this session (the server's task list replaces it).
let sent = new Set<string>();
const listeners = new Set<() => void>();
export function markSent(id: string) { sent = new Set(sent).add(id); listeners.forEach(l => l()); }
export function useSent() {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, () => sent);
}
