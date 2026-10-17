import { expect, test } from "bun:test";
import { patients } from "@/features/encounter/fixtures";
import { newEncounter } from "@/features/encounter/fixtures";
import { wardBeds } from "@/features/ward/model";
import { bookingItems, sameForToday, testInSentence } from "./model";
import { blockedRows } from "./needs-you-model";

test("a denied guarantee letter holds Amelia's bed under Discharges blocked, which opens the appeal; it goes once the appeal is sent", () => {
  const denial = { code: "MED", reason: "Admission not medically necessary", at: "2026-09-26T02:00:00Z" };
  const claim = status => ({ organismConfirmed: true, ivReasonAdded: true, status, denial });
  const beds = status => wardBeds(patients, { "SYN-1042": { ...newEncounter(), claim: claim(status) } });
  expect(beds("denied").find(b => b.patientId === "SYN-1042")?.blockers[0]).toMatchObject({ kind: "gl", label: "Final guarantee letter", detail: "Denied, appeal drafted" });
  expect(blockedRows(beds("denied"), {}, () => true).rows.find(r => r.patientId === "SYN-1042")).toMatchObject({ action: "letter", label: "Final guarantee letter" });
  expect(beds("appealed").find(b => b.patientId === "SYN-1042")?.blockers[0].detail).toBe("Appeal sent · awaiting insurer");
});

test("a booking request is an amber row that says who asks for whom, and why it is there", () => {
  const request = { id: "booking:SYN-1042:lim:1", patientId: "SYN-1042", doctorName: "Dr. Lim Wei Jie", specialty: "Respiratory", title: "Amelia asks to see Dr. Lim · Thu 10:30", reason: "still coughing", createdAt: new Date("2026-09-28T02:00:00Z") };
  const [item] = bookingItems([request], new Date("2026-09-28T02:25:00Z"));
  expect(item).toMatchObject({ id: "booking-booking:SYN-1042:lim:1", kind: "booking", title: "Amelia asks to see Dr. Lim · Thu 10:30", tone: "soon", patientId: "SYN-1042", detail: "“still coughing” · Respiratory" });
  expect(item.reason).toBe("Asked in Sona Care 25 min ago · confirm or decline");
  expect(bookingItems([{ ...request, reason: null, title: null }], new Date("2026-09-28T05:00:00Z"))[0]).toMatchObject({ detail: "Dr. Lim Wei Jie · Respiratory", title: "Booking request · Dr. Lim Wei Jie" });
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
  const { scheduleFor } = require("./model");
  const { visitRows } = require("./needs-you-model");
  const monday = new Date(2026, 8, 21); // a Monday
  expect(scheduleFor(-1, patients, monday)).toEqual([]); // Sunday
  const tuesday = scheduleFor(1, patients, monday);
  expect(tuesday.length).toBeGreaterThan(1);
  expect(tuesday.every(v => v.patientId === undefined)).toBe(true);
  expect(visitRows(tuesday, -2).every(r => r.reason.endsWith("· seen"))).toBe(true);
  expect(visitRows(tuesday, 1).map(r => r.tone)).toEqual([...tuesday].sort((a, b) => a.time.localeCompare(b.time)).map(v => v.incomplete ? "soon" : "calm"));
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
