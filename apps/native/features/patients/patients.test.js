import { expect, test } from "bun:test";
import { GROUPS, letters, listItems, serverRows, syntheticCensus } from "./census";
import { continueList, IDLE_MS, planPin, replacePin, whatIsLeft } from "./continue";

test("connected, the rest of the list is the server's people at the server's beds: the visits opened here are left out, and each row says where the patient stands", () => {
  const people = [
    { id: "SYN-1042", name: "Amelia Tan", initials: "AT", complaint: "Cough for five days, with fever since yesterday." },
    { id: "SYN-2002", name: "Nurul Huda", initials: "NH", complaint: "Day 3 of antibiotics for pyelonephritis." },
    { id: "SYN-2007", name: "Dayang Suhaila", initials: "DS", complaint: "Day 3, asthma exacerbation." },
    { id: "SYN-2012", name: "Siti Aminah", initials: "SA", complaint: "Day 2 of IV antibiotics for pneumonia." },
    { id: "SYN-3001", name: "Clinic Only", initials: "CO", complaint: "Booked for review" },
  ];
  const beds = [
    { bed: "Bed 6", patientId: "SYN-1042", name: "Amelia Tan", status: "fit", blockers: [{}] },
    { bed: "Bed 2", patientId: "SYN-2002", name: "Nurul Huda", status: "fit", blockers: [{}, {}] },
    { bed: "Bed 7", patientId: "SYN-2007", name: "Dayang Suhaila", status: "fit", blockers: [] },
    { bed: "Bed 12", patientId: "SYN-2012", name: "Siti Aminah", status: "watch", blockers: [] },
    { bed: "Bed 10", status: "empty", blockers: [] },
  ];
  const rows = serverRows(people, beds, new Set(["SYN-1042", "SYN-1086"]));
  expect(rows.map(r => [r.id, r.where, r.reason, r.tone])).toEqual([
    ["SYN-2002", "Bed 2", "2 blockers · Day 3 of antibiotics for pyelonephritis", "soon"],
    ["SYN-2007", "Bed 7", "Fit to go · Day 3, asthma exacerbation", "good"],
    ["SYN-2012", "Bed 12", "Day 2 of IV antibiotics for pneumonia", "calm"],
    ["SYN-3001", "", "Booked for review", "calm"],
  ]);
  // They wait and open nothing here; only a patient in a bed counts for the ward tab, and none joins "Needs you" or "My list".
  expect(rows.every(r => r.group === "waiting" && !r.open && !r.mine && !r.clinic)).toBe(true);
  expect(rows.map(r => r.ward)).toEqual([true, true, true, false]);
  // In the ward tab, the held discharge leads and Bed 2 sorts before Bed 12.
  expect(listItems(rows, "ward", new Set()).map(i => i.row.where)).toEqual(["Bed 2", "Bed 7", "Bed 12"]);
  // Nothing from the server yet (still reading, or it failed): no rows, never a sample.
  expect(serverRows([], [], new Set())).toEqual([]);
});

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

test("inside a group, red comes before amber whatever the time", () => {
  const row = (id, tone, where) => ({ id, name: id, initials: "X", where, group: "needs", reason: "", tone, mine: true, ward: false, clinic: true, open: true });
  const items = listItems([row("amber", "soon", "03:45"), row("red", "urgent", "04:15")], "needs", new Set());
  expect(items.filter(i => i.kind === "row").map(i => i.row.id)).toEqual(["red", "amber"]);
});
