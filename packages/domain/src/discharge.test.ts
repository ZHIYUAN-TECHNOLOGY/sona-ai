import { expect, test } from "bun:test";
import { DEMO_PATIENTS } from "./demo-patients";
import { EMPTY_DISCHARGE, decideDischarge, dischargeChecks, planFor } from "./discharge";
import { WARD_FIXTURE } from "./ward";

const amelia = DEMO_PATIENTS[0]!;
const plan = planFor(amelia);
const command = { encounterId: "visit-1042", requestId: "req-1", approvedBy: "dr.aisyah" };
const fitAt = new Date("2026-09-26T09:00:00Z");
const at = new Date("2026-09-26T09:40:00Z");

test("discharge is refused while blockers are open, naming each one", () => {
  const r = decideDischarge({ ...EMPTY_DISCHARGE, medsConfirmed: true }, plan, command, fitAt, at);
  expect(r).toEqual({ status: "refused", reason: "blocked", open: ["Final guarantee letter", "Follow-up booked"] });
});

const clear = { ...EMPTY_DISCHARGE, glReceived: true, medsConfirmed: true, followUp: "2w" as const };

test("discharge without a named approver is refused even when nothing blocks it", () => {
  expect(decideDischarge(clear, plan, { ...command, approvedBy: "  " }, fitAt, at)).toEqual({ status: "refused", reason: "unapproved", open: [] });
});

test("an approved, unblocked discharge frees the bed 235 minutes ahead of the 275-minute typical wait", () => {
  expect(decideDischarge(clear, plan, command, fitAt, at)).toEqual({
    status: "discharged", encounterId: "visit-1042", requestId: "req-1", approvedBy: "dr.aisyah", dischargedAt: "2026-09-26T09:40:00.000Z", savedMinutes: 235,
  });
});

test("no plan is written for one person: Amelia's is read from her record like anyone's, and a record that says nothing gets nothing asserted", () => {
  expect(plan.summary).toEqual({
    diagnosis: "Community-acquired pneumonia, on a background of asthma. Penicillin allergy reported.",
    course: "Community-acquired pneumonia, mild, day 2. Afebrile 18 h, SpO₂ 97% on room air.", plan: "Discharge today on oral azithromycin.",
  });
  // The take-home list is the one charted in her record, word for word.
  expect(plan.meds).toEqual(amelia.takeHome!);
  expect(plan.meds.map(m => [m.name, m.change])).toEqual([["Azithromycin", "changed"], ["Paracetamol", "new"], ["Nebulised salbutamol", "stopped"], ["Cetirizine", "unchanged"]]);
  expect(plan.leaflet.en).toStartWith("You were treated for a chest infection.");
  const bare = planFor({ id: "SYN-1042" });
  expect(bare).toMatchObject({ meds: [], visit: {}, condition: undefined, summary: { diagnosis: "Diagnosis to confirm from the notes." } });
  expect(dischargeChecks(EMPTY_DISCHARGE, bare).map(c => [c.id, c.detail])).toEqual([["meds", "None recorded"], ["followup", "Not chosen yet"]]);
});

test("each check is read from the visit's rows: observations from the chart, the summary once drafted, the guarantee letter the stay has", () => {
  const at = "2026-09-26T08:10:00.000Z", vital = (kind: string, value: number, unit: string) => ({ kind, value, unit, at });
  const checks = (visit: Parameters<typeof planFor>[0]["visit"], state = EMPTY_DISCHARGE) => dischargeChecks(state, planFor({ ...amelia, visit }));
  const stable = [vital("temperature", 36.8, "°C"), vital("pulse", 82, "bpm"), vital("oxygen-saturation", 97, "%"), vital("urea", 5.1, "mmol/L")];
  // Nothing charted, no draft, self-pay: none of the three is claimed.
  expect(checks({}).map(c => c.id)).toEqual(["meds", "followup"]);
  expect(checks({ vitals: stable }).find(c => c.id === "observations")).toMatchObject({ status: "passed", detail: "3 in range · last taken 16:10" });
  expect(checks({ vitals: [...stable, vital("temperature", 38.4, "°C"), vital("respiratory-rate", 28, "/min")] }).find(c => c.id === "observations"))
    .toEqual({ id: "observations", label: "Observations stable", status: "blocked", detail: "Temp 38.4 °C · Resp 28 /min" });
  expect(checks({ drafted: true }).map(c => [c.id, c.status])).toEqual([["summary", "passed"], ["meds", "blocked"], ["followup", "blocked"]]);
  expect(checks({ gl: { insurer: "Synthetic insurer", requestedAt: at } }).find(c => c.id === "gl")).toMatchObject({ status: "blocked", detail: "Synthetic insurer · requested 16:10" });
  // The follow-up line is the doctor's own choice for this visit.
  expect(checks({}, { ...EMPTY_DISCHARGE, followUp: "1w" }).find(c => c.id === "followup")).toMatchObject({ status: "passed", detail: "Clinic review · 1 wk" });
  // A bed nobody marked fit saves no counted minutes.
  expect(decideDischarge(clear, planFor({ ...amelia, visit: {} }), command, undefined, new Date(at))).toMatchObject({ status: "discharged", savedMinutes: 0 });
});

const ward = (bed: string) => WARD_FIXTURE.find(b => b.bed === bed)!;
const admitted = (bed: string, id: string) => ({ id, name: ward(bed).name, complaint: ward(bed).sbar!.s, bed, ward: { waitingHours: ward(bed).waitingHours, sbar: ward(bed).sbar } });

test("another patient's plan comes from their own record: condition, background, course, medicines, follow-up and leaflet", () => {
  const nurul = planFor(admitted("Bed 2", "SYN-2002"));
  expect(nurul.bed).toBe("Bed 2");
  expect(nurul.summary.diagnosis).toBe("Acute pyelonephritis.");
  expect(nurul.summary.course).toBe("Day 3 of antibiotics for pyelonephritis. Afebrile 36 h, eating and walking.");
  expect(nurul.summary.plan).toBe("Discharge once the final GL and sensitivities are in.");
  // No take-home list charted and no medicines recorded: none is drafted for her.
  expect(nurul.meds).toEqual([]);
  expect(nurul.leaflet.ms).toStartWith("Anda dirawat kerana jangkitan buah pinggang");

  const priya = planFor(admitted("Bed 8", "SYN-2008"));
  expect(priya.summary.diagnosis).toBe("Cellulitis of the leg, on a background of type 2 diabetes.");
  expect(priya.leaflet.zh).toStartWith("您因腿部皮肤感染");

  const lim = planFor(admitted("Bed 14", "SYN-2014"));
  expect(lim.condition).toBe("appendicitis");
  // Every leaflet differs from Amelia's, in all three languages.
  for (const other of [nurul, priya, lim]) for (const l of ["ms", "en", "zh"] as const) expect(other.leaflet[l]).not.toBe(plan.leaflet[l]);
});

test("own medicines carry on until the ward charts a take-home list, and an unmatched record still gets a plan", () => {
  const siti = { ...admitted("Bed 12", "SYN-2012"), medicines: ["Metformin, 500 mg twice daily", "Patient reports a tablet; ingredient unknown"] };
  expect(planFor(siti).meds).toEqual([{ name: "Metformin", change: "unchanged", detail: "Continue as before" }]);
  const charted = [{ name: "Amoxicillin", change: "changed" as const, detail: "IV to oral 1 g three times daily, to complete 5 days" }];
  expect(planFor({ ...siti, takeHome: charted }).meds).toEqual(charted);
  const daniel = planFor(DEMO_PATIENTS[1]!);
  expect(daniel.summary.diagnosis).toBe("Breathlessness on exertion; onset not yet documented.");
  expect(daniel.meds).toEqual([]);
});
