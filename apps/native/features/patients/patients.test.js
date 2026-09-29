import { expect, test } from "bun:test";
import { GROUPS, letters, listItems, syntheticCensus } from "./census";
import { continueList, IDLE_MS, planPin, replacePin, whatIsLeft } from "./continue";

test("the synthetic census is deterministic, unique and roughly 11% needs you, 6% next hour, a third waiting", () => {
  const rows = syntheticCensus(108);
  expect(rows).toHaveLength(108);
  expect(syntheticCensus(108)).toEqual(rows);
  expect(new Set(rows.map(r => r.name)).size).toBe(108);
  const count = g => rows.filter(r => r.group === g).length;
  expect([count("needs"), count("next"), count("waiting"), count("done")]).toEqual([12, 6, 41, 49]);
  expect(rows.every(r => !r.open && r.ward !== r.clinic)).toBe(true);
});

test("Needs you groups rows by urgency: the top group shows 6 with Show more, Waiting and Done start folded", () => {
  const rows = syntheticCensus(108);
  const items = listItems(rows, "needs", new Set());
  const headers = items.filter(i => i.kind === "header").map(i => [i.title, i.count]);
  expect(headers).toEqual(GROUPS.map(g => [g.title, rows.filter(r => r.group === g.id).length]));
  expect(items.filter(i => i.kind === "row")).toHaveLength(6 + 3);
  expect(items.filter(i => i.kind === "more").map(i => [i.group, i.hidden])).toEqual([["needs", 6], ["next", 3], ["waiting", 41], ["done", 49]]);
  const opened = listItems(rows, "needs", new Set(["needs"]));
  expect(opened.filter(i => i.kind === "row" && i.row.group === "needs")).toHaveLength(12);
  expect(new Set(items.map(i => i.key)).size).toBe(items.length);
});

test("All is A–Z with one header per letter, and the index lists only letters present", () => {
  const rows = syntheticCensus(40);
  const items = listItems(rows, "all", new Set());
  const names = items.filter(i => i.kind === "row").map(i => i.row.name);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  expect(items.filter(i => i.kind === "header").map(i => i.title)).toEqual(letters(rows));
  expect(items.filter(i => i.kind === "header").reduce((n, h) => n + h.count, 0)).toBe(40);
});

const now = Date.parse("2026-09-29T10:00:00Z");
test("Continue: the open visit, then pins newest first, then unfinished work under 24 h; closed and idle visits leave", () => {
  const started = [
    { id: "a", lastAt: now - 1000, left: "Note not started" },
    { id: "b", lastAt: now - 5000, left: "Draft note to sign" },
    { id: "c", lastAt: now - IDLE_MS - 1, left: "Draft note to sign" },
    { id: "d", lastAt: now - 2000, closed: true },
    { id: "e", lastAt: now - 3000 },
  ];
  const list = continueList({ current: "b", pins: [{ id: "x", at: 1 }, { id: "d", at: 2 }], started, now });
  expect(list.map(e => [e.id, e.why])).toEqual([["b", "open"], ["d", "pinned"], ["x", "pinned"], ["a", "recent"]]);
});

test("pins are capped at 5: a sixth asks to replace the oldest, and re-pinning is a no-op", () => {
  const pins = [1, 2, 3, 4, 5].map(i => ({ id: `p${i}`, at: i }));
  expect(planPin(pins.slice(0, 2), "new", 9)).toEqual({ pins: [...pins.slice(0, 2), { id: "new", at: 9 }] });
  expect(planPin(pins, "p3", 9)).toEqual({ pins });
  expect(planPin(pins, "new", 9)).toEqual({ replace: { id: "p1", at: 1 } });
  expect(replacePin(pins, "p1", "new", 9).map(p => p.id)).toEqual(["p2", "p3", "p4", "p5", "new"]);
});

test("what is left on a visit: a paused recording, a note to sign or not started; nothing once the note is reviewed", () => {
  expect(whatIsLeft({ answers: 2, hasNote: false, noteReviewed: false, recording: "paused" })).toBe("Recording paused");
  expect(whatIsLeft({ answers: 2, hasNote: true, noteReviewed: false, recording: "stopped" })).toBe("Draft note to sign");
  expect(whatIsLeft({ answers: 2, hasNote: false, noteReviewed: false, recording: "idle" })).toBe("Note not started");
  expect(whatIsLeft({ answers: 2, hasNote: true, noteReviewed: true, recording: "stopped" })).toBeUndefined();
});
