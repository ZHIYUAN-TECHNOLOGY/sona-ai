import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

/**
 * "Live backend" mode: discharge, guarantee letter, ward owners, coding audit, tasks, results, My Day,
 * prescribing checks, the consultation note, handover and X-ray upload read and write the server
 * (EXPO_PUBLIC_SERVER_URL) instead of the in-memory fixtures. Off by default; switched on in Settings
 * with a signed-in doctor. Answers that need a model (briefing, reasoning, evidence) stay authored.
 */
// Remembered across reloads, so a reload mid-flow comes back to the server's state, not the fixtures.
const KEY = "sona.liveBackend";
let live = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
export function setLive(on: boolean) { live = on; notify(); SecureStore.setItemAsync(KEY, on ? "1" : "0").catch(() => {}); }
SecureStore.getItemAsync(KEY).then(v => { if (v === "1" && !live) { live = true; notify(); } }).catch(() => {});
export function useLive() {
  const on = useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, () => live);
  const { data } = authClient.useSession();
  return { on: on && Boolean(data?.user), wanted: on, user: data?.user };
}

export const api = client;
export const requestId = () => `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/** Server blocker IDs for the demo bed (the server derives them from Amelia's admission). */
export const serverBlockerId = (kind: string) => ({ gl: "adm-1042-gl", pharmacy: "adm-1042-meds", booking: "adm-1042-followup" } as Record<string, string>)[kind];
/** The server's message, plus what is still open when it refused (claim criteria or discharge blockers). */
export function errorText(e: unknown) {
  if (!e || typeof e !== "object") return "The server did not answer";
  const { message, data } = e as { message?: unknown; data?: { open?: string[]; blockers?: { label: string }[] } };
  const open = data?.open?.length ? data.open : data?.blockers?.map(b => b.label);
  return `${typeof message === "string" ? message : "The server refused"}${open?.length ? `: ${open.join(", ").toLowerCase()} still open` : ""}`;
}
