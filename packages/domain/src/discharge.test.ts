import { expect, test } from "bun:test";
import { DEMO_PATIENTS } from "./demo-patients";
import { EMPTY_DISCHARGE, decideDischarge, dischargeChecks, planFor } from "./discharge";
import type { Patient } from "./types";
import { WARD_FIXTURE } from "./ward";

const plan = planFor({} as Patient);
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

test("Amelia keeps her authored plan, looked up by her ID or with no ID at all", () => {
  const amelia = planFor(DEMO_PATIENTS[0]!);
  expect(amelia).toEqual(plan);
  expect(amelia.summary.diagnosis).toBe("Community-acquired pneumonia, mild (CURB-65 0), on background asthma.");
  expect(amelia.meds.map(m => [m.name, m.change])).toEqual([["Azithromycin", "changed"], ["Paracetamol", "new"], ["Nebulised salbutamol", "stopped"], ["Cetirizine", "unchanged"]]);
  expect(amelia.leaflet.en).toStartWith("You were treated for a chest infection. Take azithromycin");
});

const ward = (bed: string) => WARD_FIXTURE.find(b => b.bed === bed)!;
const admitted = (bed: string, id: string) => ({ id, name: ward(bed).name, complaint: ward(bed).sbar!.s, bed, ward: { waitingHours: ward(bed).waitingHours, sbar: ward(bed).sbar } });

test("another patient's plan comes from their own record: condition, background, course, medicines, follow-up and leaflet", () => {
  const nurul = planFor(admitted("Bed 2", "SYN-2002"));
  expect(nurul.bed).toBe("Bed 2");
  expect(nurul.summary.diagnosis).toBe("Acute pyelonephritis.");
  expect(nurul.summary.course).toBe("Day 3 of antibiotics for pyelonephritis. Afebrile 36 h, eating and walking.");
  expect(nurul.meds.map(m => [m.name, m.change])).toEqual([["Cefuroxime", "changed"], ["Paracetamol", "new"]]);
  expect(nurul.leaflet.ms).toStartWith("Anda dirawat kerana jangkitan buah pinggang");
  expect(nurul.fitMinutesAgo).toBe(300);

  const priya = planFor(admitted("Bed 8", "SYN-2008"));
  expect(priya.summary.diagnosis).toBe("Cellulitis of the leg, on a background of type 2 diabetes.");
  expect(priya.meds[0]).toMatchObject({ name: "Flucloxacillin", change: "changed" });
  expect(priya.leaflet.zh).toStartWith("您因腿部皮肤感染");

  const lim = planFor(admitted("Bed 14", "SYN-2014"));
  expect(lim.meds.map(m => m.change)).toEqual(["new", "new", "stopped"]);
  expect(dischargeChecks(EMPTY_DISCHARGE, lim).find(c => c.id === "followup")!.detail).toBe("Surgical clinic · wound check in 1–2 weeks");
  // Every leaflet differs from Amelia's, in all three languages.
  for (const other of [nurul, priya, lim]) for (const l of ["ms", "en", "zh"] as const) expect(other.leaflet[l]).not.toBe(plan.leaflet[l]);
});

test("a penicillin allergy changes the drafted antibiotic, own medicines carry on, and an unmatched record still gets a plan", () => {
  const siti = { ...admitted("Bed 12", "SYN-2012"), medicines: ["Metformin, 500 mg twice daily", "Patient reports a tablet; ingredient unknown"] };
  expect(planFor(siti).meds.map(m => [m.name, m.change])).toEqual([["Amoxicillin", "changed"], ["Paracetamol", "new"], ["Metformin", "unchanged"]]);
  expect(planFor({ ...siti, allergies: "Penicillin — rash" }).meds[0]!.name).toBe("Azithromycin");
  const daniel = planFor(DEMO_PATIENTS[1]!);
  expect(daniel.summary.diagnosis).toBe("Breathlessness on exertion; onset not yet documented.");
  expect(daniel.meds).toEqual([]);
  expect(daniel.followUp).toBe("Clinic review · timing to confirm");
});
