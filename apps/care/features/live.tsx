import { focusManager, type QueryKey } from "@tanstack/react-query";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { setClockOffset } from "@/lib/clock";
import { client, orpc, queryClient } from "@/utils/orpc";
import { ENV } from "../src/env";
import { clearTaken, syncTaken } from "./doses";
import { useMe } from "./me";
import { sendQuestions } from "./questions";

/**
 * Live updates for Sona Care: one WebSocket to the patient's own channel (it only hears changes about
 * them, never patient data). A change re-reads what its topic touches; a "demo" change (the demo clock
 * moved) first re-reads the clock, so doses, days home and check-ins jump with it. After a reconnect
 * whatever was read before the drop re-reads, since changes may have been missed. The clock is read again,
 * and what this phone kept while offline (doses taken, questions for the doctor) sent, on joining, whenever
 * the socket opens and whenever the app returns to the foreground. Mounted once at the root.
 */
const PING_MS = 25_000, MAX_BACKOFF_MS = 30_000;

/**
 * What each topic the server announces (packages/api/src/events.ts) changes on the patient's screens. A topic
 * not listed re-reads everything; the echo of a dose or push token from this phone re-reads nothing.
 */
const TOUCHES: Record<string, QueryKey[]> = {
  messages: [orpc.care.messages.key()],
  // A flagged reply booked in is a visit on the Schedule.
  checkIns: [orpc.care.checkIns.key(), orpc.care.followUps.key()],
  // Confirmed: a visit on the Schedule and the slot taken; declined: a note in the thread.
  bookings: [orpc.care.bookings.key(), orpc.care.followUps.key(), orpc.care.doctors.key(), orpc.care.messages.key()],
  // An X-ray follow-up put on a booked visit.
  findings: [orpc.care.followUps.key()],
  doses: [], push: [],
};

/** A joined patient's live session (its own function, so a test can drive it); returns its stop. */
export function startLive() {
  let socket: WebSocket | undefined, ping: ReturnType<typeof setInterval> | undefined, retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false, attempt = 0, opened = false, droppedAt = 0;
  // A failed read keeps the last offset; the next foreground or open reads again.
  const readClock = () => client.care.clock().then(c => { if (!stopped) setClockOffset(c.offsetMs); }, () => {});
  // Sends what the server is missing; each part swallows its own failure and runs again on the next open or foreground.
  const send = () => Promise.all([syncTaken().catch(() => {}), sendQuestions()]);
  const catchUp = () => Promise.all([readClock(), send()]);
  const reread = async (topic: string | undefined) => {
    if (topic === "demo") await readClock();
    const touched = topic ? TOUCHES[topic] : undefined;
    const reads = touched ? touched.map(queryKey => queryClient.invalidateQueries({ queryKey })) : [queryClient.invalidateQueries()];
    await Promise.all([...reads, send()]);
  };
  void catchUp();
  // Back in the foreground (React Query's focus, which utils/orpc ties to the app's state).
  const unfocus = focusManager.subscribe(focused => { if (focused) void catchUp(); });
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
      // A reconnect: what was read before the drop may have missed changes; what the foreground re-read since is current.
      if (opened) void queryClient.invalidateQueries({ predicate: q => q.state.dataUpdatedAt < droppedAt });
      opened = true;
      void catchUp();
    };
    ws.onmessage = e => {
      if (e.data === "pong") return;
      let topic: string | undefined;
      try { topic = (JSON.parse(String(e.data)) as { topic?: string }).topic; } catch { return; /* not a change */ }
      void reread(topic);
    };
    ws.onclose = () => {
      droppedAt = Date.now();
      clearInterval(ping);
      if (stopped) return;
      retry = setTimeout(() => { void connect(); }, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++));
    };
    ws.onerror = () => { /* onclose follows and schedules the retry */ };
  };
  void connect();
  return () => { stopped = true; unfocus(); clearInterval(ping); clearTimeout(retry); socket?.close(); };
}

export function LiveUpdates() {
  const { state } = useMe();
  const joined = state === "joined";
  // Not linked to any record: doses remembered on this phone belong to no plan, so they go.
  useEffect(() => { if (state === "not-joined") clearTaken(); }, [state]);
  useEffect(() => {
    if (!joined) { setClockOffset(0); return; }
    return startLive();
  }, [joined]);
  return null;
}
