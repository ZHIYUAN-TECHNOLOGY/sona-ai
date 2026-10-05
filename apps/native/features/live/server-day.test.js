import { expect, mock, test } from "bun:test";

// The server, counting the reads it gets.
const reads = { tasks: 0, results: 0, bookings: 0 };
const list = name => async () => { reads[name]++; return []; };
// The day's read fails while `down`, then answers.
const day = { down: true, reads: 0 };
const dayList = async () => { day.reads++; if (day.down) throw new Error("Network request failed"); return [{ id: "appt-1" }]; };
mock.module("@/features/live", () => ({ api: { tasks: { list: list("tasks") }, results: { list: list("results") }, bookings: { list: list("bookings") }, day: { list: dayList } }, errorText: e => e.message, useLive: () => ({}) }));
mock.module("@/features/encounter/store", () => ({ useEncounterSelect: () => ({}), sameVisits: () => () => true }));
const { loadServerData, readServerDay, refreshServerData, serverDayCount, serverDayError, serverSnapshot } = await import("./server-day");

test("Today's widgets mounting at once share one read; a write still reads anew", async () => {
  await Promise.all(Array.from({ length: 18 }, () => loadServerData()));
  expect(reads).toEqual({ tasks: 1, results: 1, bookings: 1 });
  expect(serverSnapshot()).toEqual({ tasks: [], results: [], bookings: [] });
  await loadServerData(); // a screen mounting a moment later
  expect(reads.tasks).toBe(1);
  await refreshServerData(); // after a write or a live change
  expect(reads).toEqual({ tasks: 2, results: 2, bookings: 2 });
});

test("a day that failed to read keeps its reason until a read of it succeeds, and is never an empty day", async () => {
  await Promise.all([readServerDay("2026-10-08"), readServerDay("2026-10-08")]); // two screens at once: one read
  expect(day.reads).toBe(1);
  expect(serverDayError("2026-10-08")).toBe("Network request failed");
  day.down = false;
  await readServerDay("2026-10-08"); // Retry
  expect(serverDayError("2026-10-08")).toBeUndefined();
  expect(serverDayCount("2026-10-08")).toBe(1);
});
