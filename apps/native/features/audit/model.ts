import { useSyncExternalStore } from "react";
import type { AuditItem } from "@sona-ai/domain/audit";

export * from "@sona-ai/domain/audit";

/** Money at risk per doctor, most first: one bar each on the audit chart. */
export function riskByDoctor(items: AuditItem[]): { doctor: string; risk: number; count: number }[] {
  const by = new Map<string, { doctor: string; risk: number; count: number }>();
  for (const i of items) {
    const d = by.get(i.doctor);
    by.set(i.doctor, { doctor: i.doctor, risk: (d?.risk ?? 0) + i.risk, count: (d?.count ?? 0) + 1 });
  }
  return [...by.values()].sort((a, b) => b.risk - a.risk);
}

// A tiny shared store: which queries have gone out this session (the server's task list replaces it).
let sent = new Set<string>();
const listeners = new Set<() => void>();
export function markSent(id: string) { sent = new Set(sent).add(id); listeners.forEach(l => l()); }
export function useSent() {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, () => sent);
}
