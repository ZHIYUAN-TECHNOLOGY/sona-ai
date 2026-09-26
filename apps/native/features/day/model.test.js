import { expect, test } from "bun:test";
import { patients } from "@/features/encounter/fixtures";
import { rankDay, testInSentence } from "./model";

// Demo visits follow the clock; test from 30 minutes before the first one.
const [h, m] = patients[0].time.split(":").map(Number);
const before = h * 60 + m - 30;

test("the unactioned result leads, then the prescribing blocker, and every item has a reason", () => {
  const items = rankDay(patients, {}, before);
  expect(items[0].kind).toBe("result");
  expect(items[0].reason).toContain("no action");
  expect(items[1].kind).toBe("blocker");
  expect(items.every(item => item.reason.length > 0)).toBe(true);
});

test("a reviewed result drops out; confirmed medicines clear the blocker", () => {
  const medicationEntries = [{ id: "medicine-0", name: "A", ingredient: "salbutamol", formulation: "inhaler", confirmed: true }, { id: "medicine-1", name: "B", ingredient: "cetirizine", formulation: "tablet", confirmed: true }];
  const encounter = { revision: 1, cards: [], requests: [], note: "", noteReviewed: false, transcript: [], recording: "idle", recordingSeconds: 0, language: "english", tasks: [], medicationEntries };
  const items = rankDay(patients, { "SYN-1042": encounter }, before, new Set(["result"]));
  expect(items.some(item => item.kind === "result" || item.kind === "blocker")).toBe(false);
});

test("visits that would overlap share one pin; spaced visits stay apart", () => {
  const { groupVisits } = require("./model");
  const span = group => (group.length > 1 ? 40 : 28);
  const groups = groupVisits([{ at: 840 }, { at: 840 }, { at: 850 }, { at: 900 }, { at: 905 }], span);
  expect(groups.map(g => g.length)).toEqual([3, 2]);
  expect(groupVisits([{ at: 600 }, { at: 630 }], span).length).toBe(2);
  // A wide group pin absorbs a visit that a single pin would not.
  expect(groupVisits([{ at: 600 }, { at: 600 }, { at: 635 }], span).length).toBe(1);
});

test("other days: weekends empty, past seen, future to prepare", () => {
  const { scheduleFor, rankOtherDay } = require("./model");
  const monday = new Date(2026, 8, 21); // a Monday
  expect(scheduleFor(-1, patients, monday)).toEqual([]); // Sunday
  const tuesday = scheduleFor(1, patients, monday);
  expect(tuesday.length).toBeGreaterThan(1);
  expect(tuesday.every(v => v.patientId === undefined)).toBe(true);
  expect(rankOtherDay(-2, tuesday).every(i => i.reason.startsWith("Seen"))).toBe(true);
  expect(rankOtherDay(1, tuesday).every(i => i.reason.startsWith("Prepare"))).toBe(true);
  expect(scheduleFor(0, patients, monday).map(v => v.patientId)).toEqual(patients.map(p => p.id));
});

test("any day in a month view has a valid schedule", () => {
  const { scheduleFor } = require("./model");
  const monday = new Date(2026, 8, 21);
  for (let o = -40; o <= 40; o++) for (const v of scheduleFor(o, patients, monday)) expect(v.name.length).toBeGreaterThan(0);
});

test("a stale demo schedule moves back to upcoming; visits under way keep their time", () => {
  const { refreshDemoTimes } = require("@/features/encounter/fixtures");
  const later = new Date(); later.setHours(later.getHours() + 3);
  const started = patients[0].time;
  expect(refreshDemoTimes(id => id === patients[0].id, later)).toBe(true);
  expect(patients[0].time).toBe(started);
  const [h, m] = patients[1].time.split(":").map(Number);
  const diff = (h * 60 + m) - (later.getHours() * 60 + later.getMinutes());
  expect(((diff % 1440) + 1440) % 1440).toBeLessThan(60);
  expect(refreshDemoTimes(id => id === patients[0].id, later)).toBe(false); // already current: nothing moves
});

test("a result reads naturally mid-sentence: names lower-cased, abbreviations kept", () => {
  expect(testInSentence("Potassium")).toBe("potassium");
  expect(testInSentence("Hb")).toBe("Hb");
  expect(testInSentence("HbA1c")).toBe("HbA1c");
});
