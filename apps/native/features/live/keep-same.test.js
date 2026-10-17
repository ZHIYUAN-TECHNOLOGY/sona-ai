import { expect, test } from "bun:test";
import { keepSame } from "./keep-same";

test("a re-read with the same data keeps the value held, so its readers are left alone; a change or a first read is the new value", () => {
  const held = { tasks: [{ id: "t1", due: "2026-10-08" }] };
  expect(keepSame(held, { tasks: [{ id: "t1", due: "2026-10-08" }] })).toBe(held);
  const changed = { tasks: [{ id: "t1", due: "2026-10-09" }] };
  expect(keepSame(held, changed)).toBe(changed);
  const first = [{ id: "bed-6" }];
  expect(keepSame(undefined, first)).toBe(first);
});
