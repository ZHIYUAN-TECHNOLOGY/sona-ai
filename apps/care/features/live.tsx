import { useEffect } from "react";
import { AppState } from "react-native";
import { authClient } from "@/lib/auth-client";
import { setClockOffset } from "@/lib/clock";
import { client, queryClient } from "@/utils/orpc";
import { ENV } from "../src/env";
import { clearTaken, syncTaken } from "./doses";
import { useMe } from "./me";
import { sendQuestions } from "./questions";

/**
 * Live updates for Sona Care: one WebSocket to the patient's own channel (it only hears changes about
 * them, never patient data). Any change re-reads what the app shows; a "demo" change (the demo clock
 * moved) first re-reads the clock, so doses, days home and check-ins jump with it. After a reconnect
 * everything re-reads, since changes may have been missed. What this phone kept while offline (doses
 * taken, questions for the doctor) is sent on joining, whenever the socket opens and whenever the app
 * returns to the foreground. Mounted once at the root.
 */
const PING_MS = 25_000, MAX_BACKOFF_MS = 30_000;

async function readClock() {
  try { setClockOffset((await client.care.clock()).offsetMs); } catch { /* keeps the last offset */ }
}

export function LiveUpdates() {
  const { state } = useMe();
  const joined = state === "joined";
  // Not linked to any record: doses remembered on this phone belong to no plan, so they go.
  useEffect(() => { if (state === "not-joined") clearTaken(); }, [state]);
  useEffect(() => {
    if (!joined) { setClockOffset(0); return; }
    // Sends what the server is missing; each part swallows its own failure and runs again on the next open or foreground.
    const catchUp = () => Promise.all([syncTaken().catch(() => {}), sendQuestions()]);
    void readClock();
    void catchUp();
    const foreground = AppState.addEventListener("change", s => { if (s === "active") void catchUp(); });
    let socket: WebSocket | undefined, ping: ReturnType<typeof setInterval> | undefined, retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false, attempt = 0, opened = false;
    const reread = async (demo: boolean) => {
      if (demo) await readClock();
      await Promise.all([queryClient.invalidateQueries(), catchUp()]);
    };
    const connect = async () => {
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
        ping = setInterval(() => { try { ws.send("ping"); } catch { /* reconnect handles it */ } }, PING_MS);
        void (opened ? reread(true) : catchUp());
        opened = true;
      };
      ws.onmessage = e => {
        if (e.data === "pong") return;
        try { void reread((JSON.parse(String(e.data)) as { topic?: string }).topic === "demo"); } catch { /* not a change */ }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (stopped) return;
        retry = setTimeout(() => { void connect(); }, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++));
      };
      ws.onerror = () => { /* onclose follows and schedules the retry */ };
    };
    void connect();
    return () => { stopped = true; foreground.remove(); clearInterval(ping); clearTimeout(retry); socket?.close(); };
  }, [joined]);
  return null;
}
