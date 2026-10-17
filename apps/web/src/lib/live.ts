import { type Query, type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Live updates for Sona Pro, as the phone apps follow them (apps/native/features/live, apps/care/features/live.tsx): one
 * WebSocket to the hospital's channel, where the server announces what a write changed (a topic named for its router,
 * and the visit; never patient data, packages/api/src/events.ts). A change re-reads the open queries of that router (an
 * insurer's decision is a "claim" change, so the guarantee letter updates in place); after a reconnect everything open
 * re-reads, since changes may have been missed.
 */
const PING_MS = 25_000, MAX_BACKOFF_MS = 30_000;
// A query kept for good (`staleTime: Infinity`: a model's draft, a film) is never re-read by a change: that would run the model again.
const changeable = { predicate: (q: Query) => (q.options as { staleTime?: unknown }).staleTime !== Infinity };

/** Opens the socket and keeps it open, reconnecting with back-off; returns its stop. */
export function startLive(queryClient: QueryClient, url: string) {
  let socket: WebSocket | undefined, ping: ReturnType<typeof setInterval> | undefined, retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false, attempt = 0, opened = false;
  const connect = () => {
    const ws = (socket = new WebSocket(url));
    ws.onopen = () => {
      // The back-off resets once a socket has stayed open a while, so one that opens and drops at once can't reconnect every second.
      const steady = setTimeout(() => { attempt = 0; }, 10_000);
      ws.addEventListener("close", () => clearTimeout(steady));
      ping = setInterval(() => { try { ws.send("ping"); } catch { /* reconnect handles it */ } }, PING_MS);
      if (opened) void queryClient.invalidateQueries(changeable);
      opened = true;
    };
    ws.onmessage = e => {
      if (e.data === "pong") return;
      let topic: unknown;
      try { topic = (JSON.parse(String(e.data)) as { topic?: unknown }).topic; } catch { return; /* not a change */ }
      // oRPC's query keys start with the procedure's path, so [[topic]] matches every query of that router.
      if (typeof topic === "string") void queryClient.invalidateQueries({ queryKey: [[topic]], ...changeable });
    };
    ws.onclose = () => {
      clearInterval(ping);
      if (!stopped) retry = setTimeout(connect, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++));
    };
  };
  connect();
  return () => { stopped = true; clearInterval(ping); clearTimeout(retry); socket?.close(); };
}

/** Live updates while mounted: once, in Sona Pro's frame. The Worker serves this app, so the session cookie signs the socket in. */
export function useLiveUpdates() {
  const queryClient = useQueryClient();
  useEffect(() => startLive(queryClient, `${location.origin.replace(/^http/, "ws")}/live`), [queryClient]);
}
