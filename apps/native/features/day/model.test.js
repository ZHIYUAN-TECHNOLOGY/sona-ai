import { expect, test } from "bun:test";
import { patients } from "@/features/encounter/fixtures";
import { newEncounter } from "@/features/encounter/fixtures";
import { wardBeds } from "@/features/ward/model";
import { bookingItems, glDeniedItems, rankDay, sameForToday, testInSentence } from "./model";

test("a denied guarantee letter is an amber My Day row that opens the appeal, and it goes once the appeal is sent", () => {
  const denial = { code: "MED", reason: "Admission not medically necessary", at: "2026-09-26T02:00:00Z" };
  const claim = status => ({ organismConfirmed: true, ivReasonAdded: true, status, denial });
  const beds = status => wardBeds(patients, { "SYN-1042": { ...newEncounter(), claim: claim(status) } });
  expect(beds("denied").find(b => b.patientId === "SYN-1042")?.blockers[0]).toMatchObject({ kind: "gl", label: "Final guarantee letter", detail: "Denied, appeal drafted" });
  expect(glDeniedItems(beds("denied"))).toEqual([{ id: "gl-denied-SYN-1042", kind: "claim", title: "GL denied · Amelia · appeal ready", detail: "Final guarantee letter",
    reason: "Insurer denied the final GL · check the appeal and send", tone: "soon", score: 72, patientId: "SYN-1042", open: { view: "claim" } }]);
  expect(beds("appealed").find(b => b.patientId === "SYN-1042")?.blockers[0].detail).toBe("Appeal sent · awaiting insurer");
  expect(glDeniedItems(beds("appealed"))).toEqual([]);
});

test("a booking request is an amber row that says who asks for whom, and why it is there", () => {
  const request = { id: "booking:SYN-1042:lim:1", patientId: "SYN-1042", doctorName: "Dr. Lim Wei Jie", specialty: "Respiratory", title: "Amelia asks to see Dr. Lim · Thu 10:30", reason: "still coughing", createdAt: new Date("2026-09-28T02:00:00Z") };
  const [item] = bookingItems([request], new Date("2026-09-28T02:25:00Z"));
  expect(item).toMatchObject({ id: "booking-booking:SYN-1042:lim:1", kind: "booking", title: "Amelia asks to see Dr. Lim · Thu 10:30", tone: "soon", patientId: "SYN-1042", detail: "“still coughing” · Respiratory" });
  expect(item.reason).toBe("Asked in Sona Care 25 min ago · confirm or decline");
  expect(bookingItems([{ ...request, reason: null, title: null }], new Date("2026-09-28T05:00:00Z"))[0]).toMatchObject({ detail: "Dr. Lim Wei Jie · Respiratory", title: "Booking request · Dr. Lim Wei Jie" });
});

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

test("an urgent unanswered message is a red row in the patient's words; against a worse check-in the newer leads, an urgent one still first", () => {
  const { byUrgency, messageItems } = require("./model");
  const thread = { patientId: "SYN-1042", name: "Amelia Tan", label: "urgent", reason: "Breathless on walking", lastText: "sesak nafas bila jalan sikit dari pagi tadi", lastAt: "2026-09-28T03:00:00Z", waitingSince: "2026-09-28T02:40:00Z", handled: false };
  const [message, ...others] = messageItems([thread, { ...thread, patientId: "SYN-1", label: "clinical" }, { ...thread, patientId: "SYN-2", handled: true }], new Date("2026-09-28T03:10:00Z"));
  expect(others).toEqual([]);
  expect(message).toMatchObject({ id: "message-SYN-1042", kind: "message", title: "Amelia: sesak nafas bila jalan sikit dari…", detail: "Breathless on walking", reason: "Urgent message · no reply for 30 min", tone: "urgent" });
  const flag = (score, at) => ({ id: `check-in-${at}`, kind: "check-in", score, at: new Date(at).getTime() });
  const result = { id: "result", kind: "result", score: 100 };
  expect([result, flag(105, "2026-09-28T02:00:00Z"), message].sort(byUrgency).map(i => i.kind)).toEqual(["message", "check-in", "result"]);
  expect([message, flag(105, "2026-09-28T04:00:00Z")].sort(byUrgency).map(i => i.kind)).toEqual(["check-in", "message"]);
  expect([message, flag(120, "2026-09-28T01:00:00Z")].sort(byUrgency).map(i => i.kind)).toEqual(["check-in", "message"]);
});

test("Today reads a visit the same while it streams an answer in, and differently once it starts, its medicines or its tasks change", () => {
  const visit = newEncounter(), held = { "SYN-1042": visit };
  // A card arriving, a note edited: Today ranks nothing from these, so it is left alone.
  expect(sameForToday(held, { "SYN-1042": { ...visit, cards: [], note: "Seen" } })).toBe(true);
  expect(sameForToday(held, { "SYN-1042": { ...visit, requests: [{ id: "r1" }] } })).toBe(false);
  expect(sameForToday(held, { "SYN-1042": { ...visit, tasks: [] } })).toBe(false);
  expect(sameForToday(held, { "SYN-1042": { ...visit, medicationEntries: [] } })).toBe(false);
  expect(sameForToday(held, { ...held, "SYN-1086": newEncounter() })).toBe(false);
});
