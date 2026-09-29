import { expect, test } from "bun:test";
import { bedBlockers, clockLabel, forecastBeds, forecastLine, freedBed, wardBeds } from "./ward";

test("a bed with nothing cleared lists every blocker with a stable id and kind", () => {
  const blockers = bedBlockers({
    admissionId: "adm-6", gl: { status: "requested", claimStatus: "sent" }, medsConfirmed: false, followUpBooked: false,
    pendingResults: [{ id: "lab-9", test: "Urine culture sensitivities", expected: "12:00" }],
  });
  expect(blockers).toEqual([
    { id: "adm-6-gl", kind: "gl", label: "Final guarantee letter", detail: "Sent · awaiting insurer" },
    { id: "adm-6-meds", kind: "pharmacy", label: "Take-home medicines", detail: "Not yet confirmed" },
    { id: "adm-6-followup", kind: "booking", label: "Follow-up booking", detail: "Clinic review not booked" },
    { id: "adm-6-result-lab-9", kind: "result", label: "Urine culture sensitivities", detail: "Expected by 12:00" },
  ]);
});

test("a received guarantee letter, confirmed medicines and a booked follow-up leave no blockers", () => {
  expect(bedBlockers({ admissionId: "adm-6", gl: { status: "received" }, medsConfirmed: true, followUpBooked: true, pendingResults: [] })).toEqual([]);
});

test("a ride still to arrange holds the bed; a bed not yet fit is not held by take-home medicines or follow-up", () => {
  expect(bedBlockers({ admissionId: "adm-14", medsConfirmed: true, followUpBooked: true, pendingResults: [], transport: { label: "Ride home", detail: "Family free after 17:00" } })).toEqual([
    { id: "adm-14-transport", kind: "transport", label: "Ride home", detail: "Family free after 17:00" },
  ]);
  expect(bedBlockers({ admissionId: "adm-9", fit: false, medsConfirmed: false, followUpBooked: false, pendingResults: [{ id: "r1", test: "Renal function" }] })).toEqual([
    { id: "adm-9-result-r1", kind: "result", label: "Renal function", detail: "Pending" },
  ]);
});

test("a self-pay admission with no guarantee letter is not blocked on one; an unsent claim reads as codes to review", () => {
  expect(bedBlockers({ admissionId: "adm-2", medsConfirmed: true, followUpBooked: true, pendingResults: [] })).toEqual([]);
  expect(bedBlockers({ admissionId: "adm-2", gl: { status: "requested" }, medsConfirmed: true, followUpBooked: true, pendingResults: [{ id: "r1", test: "Renal function" }] })).toEqual([
    { id: "adm-2-gl", kind: "gl", label: "Final guarantee letter", detail: "Codes ready to review" },
    { id: "adm-2-result-r1", kind: "result", label: "Renal function", detail: "Pending" },
  ]);
});

// The demo ward at 09:00 in Kuala Lumpur (the seed's morning).
const NINE = new Date("2026-09-26T09:00:00+08:00");
const at = (hhmm: string, day = 26) => new Date(`2026-09-${day}T${hhmm}:00+08:00`);
const ward = () => wardBeds([], {});
const bed = (id: string) => ward().find(b => b.bed === id)!;

test("the forecast orders beds by when they free up, today then tomorrow, with a confidence each", () => {
  const f = forecastBeds(ward(), NINE);
  expect(f.timeline.map(e => [e.bed, clockLabel(e.at), e.confidence])).toEqual([
    ["Bed 10", "12:30 pm", "high"], // cleaning, ready 12:30
    ["Bed 8", "1 pm", "high"], // fit, nothing holding it: its planned time
    ["Bed 6", "6 pm", "medium"], // no planned time: now + 1 h, + GL 3 + medicines 1.5 + booking 0.5, + 1 h per unowned blocker
    ["Bed 2", "6 pm", "medium"], // 11:00 + GL 3 + result 2 + 2 unowned
    ["Bed 14", "7 pm", "medium"], // 14:30 + medicines 1.5 + ride 1 + 2 unowned
    ["Bed 12", "11 am", "low"], // watch: tomorrow's round
  ]);
  expect(f.timeline.at(-1)!.at).toEqual(at("11:00", 27));
  // Bed 9 is on watch "in 2 days" and Bed 4 is a long stay: neither is in the window.
  expect(f.timeline.some(e => e.bed === "Bed 9" || e.bed === "Bed 4")).toBe(false);
  expect(f.today).toEqual({ count: 5, byTime: "by 7 pm" });
  expect(f.tomorrow).toEqual({ count: 1 });
  expect(f.label).toBe("5 beds free by 7 pm: Bed 10 at 12:30 pm, Bed 8 at 1 pm, Bed 6 at 6 pm, Bed 2 at 6 pm, Bed 14 at 7 pm; 1 tomorrow");
  expect(forecastLine(f)).toBe("Forecast · 5 beds free by 7 pm · 1 tomorrow");
});

test("each blocker is a named reason; an owner takes the unowned hour off, and a received result takes its 2 h off", () => {
  expect(forecastBeds([bed("Bed 2")], NINE).timeline[0]!.reasons).toEqual([
    "Planned out 11 am", "Final guarantee letter +3 h", "No owner for final guarantee letter +1 h",
    "Urine culture sensitivities +2 h", "No owner for urine culture sensitivities +1 h",
  ]);
  expect(forecastBeds([bed("Bed 2")], NINE, { "b2-gl": "Billing" }).timeline[0]!.at).toEqual(at("17:00"));
  const received = { ...bed("Bed 2"), blockers: bed("Bed 2").blockers.filter(x => x.kind !== "result") };
  expect(forecastBeds([received], NINE, { "b2-gl": "Billing" }).timeline[0]!.at).toEqual(at("14:00"));
  // Medicines 1.5 h and a ride 1 h, both owned: 14:30 + 2.5 h.
  expect(forecastBeds([bed("Bed 14")], NINE, { "b14-pharm": "Pharmacy", "b14-ride": "Porter" }).timeline[0]!.at).toEqual(at("17:00"));
});

test("a planned time already past counts from now; empty and freed beds are free now or at their ready time", () => {
  const three = at("15:00");
  const f = forecastBeds([bed("Bed 8"), bed("Bed 10"), freedBed("Bed 6")], three);
  expect(f.timeline.map(e => [e.bed, e.at, e.reasons[0]])).toEqual([
    ["Bed 8", three, "Planned out 1 pm"], ["Bed 10", three, "Free now"], ["Bed 6", three, "Free now"],
  ]);
  expect(f.today.byTime).toBe("now");
  expect(f.label).toBe("3 beds free now: Bed 8 now, Bed 10 now, Bed 6 now; 0 tomorrow");
  // A fit bed with no planned time and nothing holding it: about an hour.
  expect(forecastBeds([{ ...bed("Bed 6"), blockers: [] }], NINE).timeline[0]).toMatchObject({ at: at("10:00"), confidence: "high", reasons: ["No planned time · about 1 h"] });
});

test("the unlock is the blocker that frees the most hours, the soonest bed on a tie, with its owner or the suggested team", () => {
  // Bed 6's and Bed 2's GLs both save 4 h (3 + the unowned hour) and both beds then land at 2 pm: Bed 6 leads the ward, so it wins.
  expect(forecastBeds(ward(), NINE).unlock).toEqual({
    bed: "Bed 6", blockerId: "b6-gl", label: "Final guarantee letter", owner: "Billing", owned: false, hours: 4,
    line: "Chase Bed 6's final guarantee letter → frees ~4 h earlier",
  });
  // Owned, Bed 6's GL saves only 3 h, so Bed 2's unowned GL is the one to chase.
  expect(forecastBeds(ward(), NINE, { "b6-gl": "Billing" }).unlock).toMatchObject({ bed: "Bed 2", blockerId: "b2-gl", owned: false, hours: 4 });
  // Every GL and result owned: both GLs save 3 h; Bed 6 (listed second) would then free at noon, Bed 2 at 1 pm, so Bed 6 wins.
  const owned = { "b6-gl": "Billing", "b6-meds": "Pharmacy", "b6-followup": "Nurse", "b2-gl": "Billing", "b2-result": "Nurse" } as const;
  expect(forecastBeds([bed("Bed 2"), bed("Bed 6")], NINE, owned).unlock).toMatchObject({ bed: "Bed 6", blockerId: "b6-gl", owner: "Billing", owned: true, hours: 3 });
  // Nothing blocked: no unlock.
  expect(forecastBeds(ward().map(b => ({ ...b, blockers: b.status === "fit" ? [] : b.blockers })), NINE).unlock).toBeUndefined();
});

test("a late bed reads by midnight, and an empty forecast says so", () => {
  expect(forecastBeds([{ ...bed("Bed 14"), predicted: "18:45" }], NINE).today.byTime).toBe("by midnight");
  expect(forecastBeds([], NINE)).toMatchObject({ today: { count: 0 }, tomorrow: { count: 0 }, timeline: [], label: "No beds free today; 0 tomorrow" });
});
