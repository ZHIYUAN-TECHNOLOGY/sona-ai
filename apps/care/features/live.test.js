import { expect, mock, test } from "bun:test";
import { focusManager } from "@tanstack/react-query";

// The hospital's demo clock, the sockets the app opened and what it asked to re-read.
let offsetMs = 0, clockReads = 0;
const sockets = [], invalidated = [];
globalThis.WebSocket = class {
  closers = [];
  constructor() { sockets.push(this); }
  send() {}
  addEventListener(_, close) { this.closers.push(close); }
  close() { this.closers.forEach(c => c()); this.onclose?.(); }
};
// oRPC's query keys start with the route's path; this stand-in knows only the path.
const keyed = path => new Proxy({}, { get: (_, part) => (part === "key" ? () => [path] : keyed([...path, part])) });
mock.module("@/lib/auth-client", () => ({ authClient: { getCookie: async () => null } }));
mock.module("@/utils/orpc", () => ({
  orpc: keyed([]),
  client: { care: { clock: async () => { clockReads++; return { offsetMs }; } } },
  queryClient: { invalidateQueries: (filters = {}) => { invalidated.push(filters); } },
}));
mock.module("../src/env", () => ({ ENV: { EXPO_PUBLIC_SERVER_URL: "http://localhost:3000" } }));
mock.module("./doses", () => ({ clearTaken() {}, syncTaken: async () => {} }));
mock.module("./me", () => ({ useMe: () => ({ state: "joined" }) }));
mock.module("./questions", () => ({ sendQuestions: async () => {} }));
const { now, setClockOffset } = await import("@/lib/clock");
const { COALESCE_MS, startLive } = await import("./live");
const settle = (ms = 0) => new Promise(r => setTimeout(r, ms));

test("Care reads the hospital's clock on joining, on every return to the foreground and on every socket open", async () => {
  const stop = startLive();
  await settle();
  expect(clockReads).toBe(1);
  offsetMs = 21 * 3600_000; // the demo clock jumped while the app was away
  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await settle();
  expect(clockReads).toBe(2);
  expect(now().getTime() - Date.now()).toBeGreaterThan(offsetMs - 1000);
  sockets.at(-1).onopen();
  await settle();
  expect(clockReads).toBe(3);
  stop();
  setClockOffset(0);
});

test("a change re-reads what its topic touches, any other topic her visit's record, a burst once; a reconnect what was read before the drop", async () => {
  const stop = startLive();
  await settle();
  const socket = sockets.at(-1);
  socket.onopen();
  const heard = async (...topics) => {
    await settle(COALESCE_MS + 20);
    invalidated.length = 0;
    for (const topic of topics) socket.onmessage({ data: JSON.stringify({ topic }) });
    await settle(COALESCE_MS + 20);
    return invalidated.map(f => f.queryKey);
  };
  const visit = [[["care", "me"]], [["care", "discharge"]], [["care", "followUps"]], [["care", "checkIns"]]];
  expect(await heard("messages")).toEqual([[["care", "messages"]]]);
  expect(await heard("doses")).toEqual([]); // the echo of a dose taken on this phone
  // Staff approved her discharge (the Worker tells the visit's patient): who she is, her plan, medicines, leaflet, visits and check-ins re-read.
  expect(await heard("discharge")).toEqual(visit);
  expect(await heard("visit")).toEqual(visit);
  // One save announcing three topics re-reads each query once.
  expect(await heard("note", "discharge", "messages")).toEqual([...visit, [["care", "messages"]]]);
  expect(await heard("demo")).toEqual([undefined]); // the demo clock moved: everything
  invalidated.length = 0;
  socket.onclose();
  socket.onopen(); // the retry is back
  const [{ predicate }] = invalidated;
  expect(predicate({ state: { dataUpdatedAt: Date.now() - 60_000 } })).toBe(true);
  expect(predicate({ state: { dataUpdatedAt: Date.now() + 1 } })).toBe(false); // re-read on the foreground since the drop
  stop();
  setClockOffset(0);
});
