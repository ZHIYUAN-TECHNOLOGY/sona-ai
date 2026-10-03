import { expect, mock, test } from "bun:test";

// The server, counting the reads it gets.
const reads = { tasks: 0, results: 0, bookings: 0 };
const list = name => async () => { reads[name]++; return []; };
mock.module("@/features/live", () => ({ api: { tasks: { list: list("tasks") }, results: { list: list("results") }, bookings: { list: list("bookings") } }, useLive: () => ({}) }));
mock.module("@/features/encounter/store", () => ({ useEncounter: () => ({}) }));
const { loadServerData, refreshServerData, serverSnapshot } = await import("./server-day");

test("Today's widgets mounting at once share one read; a write still reads anew", async () => {
  await Promise.all(Array.from({ length: 18 }, () => loadServerData()));
  expect(reads).toEqual({ tasks: 1, results: 1, bookings: 1 });
  expect(serverSnapshot()).toEqual({ tasks: [], results: [], bookings: [] });
  await loadServerData(); // a screen mounting a moment later
  expect(reads.tasks).toBe(1);
  await refreshServerData(); // after a write or a live change
  expect(reads).toEqual({ tasks: 2, results: 2, bookings: 2 });
});
