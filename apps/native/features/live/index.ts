import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";
import { ENV } from "../../src/env";
import { wantsLive } from "./judge";

/**
 * "Live backend" mode: discharge, guarantee letter, ward owners, coding audit, tasks, results, My Day,
 * prescribing checks, the consultation note, handover, X-ray upload and incidental findings read and write the server
 * (EXPO_PUBLIC_SERVER_URL) instead of the in-memory fixtures. Off by default; switched on in Settings
 * with a signed-in doctor. Answers that need a model (briefing, reasoning, discharge draft, claim codes,
 * huddle brief, evidence) come from the server's model routes (./model-sync), labelled while they are samples.
 */
/**
 * The judge build (EXPO_PUBLIC_JUDGE_BUILD, off by default): the hospital record is the only mode and no
 * control fakes an event (rules in ./judge). Read as text too, in case a build inlines the flag as "true".
 */
export const JUDGE = String(ENV.EXPO_PUBLIC_JUDGE_BUILD) === "true";
// Remembered across reloads, so a reload mid-flow comes back to the server's state, not the fixtures.
const KEY = "sona.liveBackend";
// The judge build starts connected and stays so: the remembered choice cannot switch it off.
let live = wantsLive(JUDGE, false);
// Whether the remembered choice has been read yet: until then, `on: false` means "not known", not "off".
let known = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
export function setLive(on: boolean) { live = wantsLive(JUDGE, on); known = true; notify(); SecureStore.setItemAsync(KEY, on ? "1" : "0").catch(() => {}); }
SecureStore.getItemAsync(KEY).then(v => { if (v === "1" && !live) live = true; }).catch(() => {}).finally(() => { known = true; notify(); });
/** True once the live choice is known and, when it is on, the session check has finished (signed in or not). */
export function useLiveSettled() {
  const isKnown = useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, () => known);
  const wanted = useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, () => live);
  const { isPending } = authClient.useSession();
  return isKnown && (!wanted || !isPending);
}
export function useLive() {
  const on = useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, () => live);
  const { data } = authClient.useSession();
  return { on: on && Boolean(data?.user), wanted: on, user: data?.user };
}

export const api = client;
export const requestId = () => `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/** expo/fetch's own failure (the network dropped, or the server was never reached): its text names native files and lines. */
export const lostConnection = (e: unknown) => String((e as { message?: unknown } | undefined)?.message ?? "").startsWith("fetch failed");
/** The server's message, plus what is still open when it refused (claim criteria or discharge blockers). */
export function errorText(e: unknown) {
  if (!e || typeof e !== "object") return "The server did not answer";
  if (lostConnection(e)) return "Sona lost the connection. Try again.";
  const { message, data } = e as { message?: unknown; data?: { open?: string[]; blockers?: { label: string }[] } };
  const open = data?.open?.length ? data.open : data?.blockers?.map(b => b.label);
  return `${typeof message === "string" ? message : "The server refused"}${open?.length ? `: ${open.join(", ").toLowerCase()} still open` : ""}`;
}
