import type { Change } from "@sona-ai/api/events";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth-client";
import { ENV } from "../../src/env";
import { useLive } from ".";
import { refreshCheckIns } from "@/features/check-ins/state";
import { rereads, type Reread } from "./channel-routing";
import { refreshFindings } from "./findings-sync";
import { refreshServerData } from "./server-day";

/**
 * Live updates over one WebSocket: the server announces what a write changed (a topic and a visit,
 * never patient data), and screens re-read just that through the normal API. After a reconnect
 * everything re-reads, so a change missed while offline cannot leave a screen stale. Screens keep a
 * slow check as a safety net. In the background iOS suspends the socket; push notifications are
 * what reach a locked phone.
 */
type Listener = (parts: Reread[], encounterId?: string) => void;
const listeners = new Set<Listener>();
let status: "off" | "connecting" | "connected" = "off";
const statusListeners = new Set<() => void>();
const setStatus = (next: typeof status) => { status = next; statusListeners.forEach(l => l()); };

function emit(change: Change | "resync") {
  const parts = rereads(change);
  if (!parts.length) return;
  const encounterId = change === "resync" ? undefined : change.encounterId;
  listeners.forEach(l => l(parts, encounterId));
}

/** Calls `onChange` when a change touches one of `parts` (for "visit", only that encounter's, or any after a reconnect). */
export function useLiveChanges(parts: Reread[], onChange: () => void, encounterId?: string) {
  const handler = useRef(onChange);
  useEffect(() => { handler.current = onChange; });
  const key = parts.join(",");
  useEffect(() => {
    const listener: Listener = (touched, changed) => {
      const hit = touched.some(p => key.split(",").includes(p) && (p !== "visit" || !changed || !encounterId || changed === encounterId));
      if (hit) handler.current();
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [key, encounterId]);
}

/** Whether live updates are connected, for the settings screen. */
export function useLiveStatus() {
  return useSyncExternalStore(l => { statusListeners.add(l); return () => { statusListeners.delete(l); }; }, () => status);
}

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

/** Keeps one socket open while live mode is on and signed in, reconnecting with back-off. Mounted once at the root. */
export function LiveUpdates() {
  const { on } = useLive();
  // The shared stores (My Day's results and tasks, check-ins, findings) re-read here; screens with their own state subscribe.
  useLiveChanges(["day"], () => { void refreshServerData().catch(() => {}); });
  useLiveChanges(["checkIns"], () => { void refreshCheckIns().catch(() => {}); });
  useLiveChanges(["findings"], () => { void refreshFindings().catch(() => {}); });
  useEffect(() => {
    if (!on) { setStatus("off"); return; }
    let socket: WebSocket | undefined, ping: ReturnType<typeof setInterval> | undefined, retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false, attempt = 0, opened = false;
    const connect = async () => {
      setStatus("connecting");
      const cookie = await authClient.getCookie();
      if (stopped) return;
      // React Native's WebSocket takes headers as a third argument; the session cookie signs the socket in.
      const ws = new (WebSocket as unknown as new (url: string, protocols: undefined, options: { headers: Record<string, string> }) => WebSocket)(
        `${ENV.EXPO_PUBLIC_SERVER_URL.replace(/^http/, "ws")}/live`, undefined, { headers: cookie ? { Cookie: cookie } : {} });
      socket = ws;
      ws.onopen = () => {
        // The back-off resets once a socket has stayed open a while, so one that opens and drops at once can't reconnect every second.
        const steady = setTimeout(() => { attempt = 0; }, 10_000);
        ws.addEventListener("close", () => clearTimeout(steady));
        setStatus("connected");
        ping = setInterval(() => { try { ws.send("ping"); } catch { /* reconnect handles it */ } }, PING_MS);
        // The first connect needs no catch-up (screens read on open); a reconnect may have missed changes.
        if (opened) emit("resync");
        opened = true;
      };
      ws.onmessage = e => {
        if (e.data === "pong") return;
        try { emit(JSON.parse(String(e.data)) as Change); } catch { /* not a change */ }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (stopped) return;
        setStatus("connecting");
        retry = setTimeout(() => { void connect(); }, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++));
      };
      ws.onerror = () => { /* onclose follows and schedules the retry */ };
    };
    void connect();
    return () => { stopped = true; clearInterval(ping); clearTimeout(retry); socket?.close(); setStatus("off"); };
  }, [on]);
  return null;
}
