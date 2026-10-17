import { expect, test } from "bun:test";
import { getPrescriptionChecks } from "./clinical-state";
import { patients } from "./fixtures";
import { nextSteps, prescribingState, receiptWords } from "./next-steps";

const base = { revision: 1, cards: [], requests: [], note: "", noteReviewed: false, transcript: [], recording: "idle", recordingSeconds: 0, language: "english", tasks: [] };
const confirmed = [{ id: "medicine-0", name: "Salbutamol", ingredient: "salbutamol", formulation: "inhaler", confirmed: true }, { id: "medicine-1", name: "Cetirizine", ingredient: "cetirizine", formulation: "tablet", confirmed: true }];
const regimen = "Paracetamol 500 mg tablet · 1000 mg · Oral · Every 6 hours · 3 days";
const eligible = { weightKg: "62", liverDisease: "no", kidneyDisease: "no", alcoholRisk: "no", paracetamolAllergy: "no" };
const left = steps => steps.slice(0, -1).filter(step => !step.done).length;

test("one step per card check, then prescribing: the bar's count is the card's Resolve N", () => {
  for (const [encounter, patient] of [[base, patients[0]], [{ ...base, medicationEntries: confirmed, medicationCheckedRevision: 1 }, patients[0]], [base, patients[1]]]) {
    const steps = nextSteps("medication", encounter, patient);
    const blocked = getPrescriptionChecks(encounter, patient).filter(check => check.status === "blocked").length;
    expect(steps).toHaveLength(getPrescriptionChecks(encounter, patient).length + 1);
    expect(left(steps)).toBe(blocked);
    expect(steps.at(-1)).toMatchObject({ id: "simulate", action: { type: "run", kind: "prescription" } });
  }
});

test("the first unconfirmed medicine is confirmed from the bar; the review is the last check", () => {
  const steps = nextSteps("medication", base, patients[0]);
  expect(steps.find(step => step.id === "identity").action).toEqual({ label: "Confirm", type: "confirm", entryId: "medicine-0" });
  expect(steps.at(-2).id).toBe("review");
  // Daniel's missing indication and unknown tablet show too, as on his card.
  expect(nextSteps("medication", base, patients[1]).find(step => !step.done).id).toBe("indication");
});

test("a role that can't prescribe sees the prescribing step locked", () => {
  const ready = { ...base, proposedMedicine: regimen, medicationEntries: confirmed, medicationCheckedRevision: 1, prescriptionInputs: eligible };
  expect(nextSteps("prescription", ready, patients[0], false).at(-1).locked).toBe(true);
  expect(nextSteps("prescription", ready, patients[0]).at(-1).locked).toBeUndefined();
  expect(prescribingState(ready, patients[0])).toBe("ready");
  // Without an entered regimen the visit is not ready: nothing stands in for the clinician's choice.
  expect(prescribingState({ ...ready, proposedMedicine: undefined }, patients[0])).toBeUndefined();
});

test("the last step says what really happens: it names the entered medicine, and a receipt reads as recorded, not simulated", () => {
  const ready = { ...base, proposedMedicine: regimen, medicationEntries: confirmed, medicationCheckedRevision: 1, prescriptionInputs: eligible };
  expect(nextSteps("prescription", base, patients[0]).at(-1).label).toBe("Prescribe");
  expect(nextSteps("prescription", ready, patients[0]).at(-1)).toMatchObject({ label: "Prescribe paracetamol", detail: "Records this prescription on the visit. Nothing is sent to a pharmacy. It can't be edited afterwards, only amended." });
  const done = { ...ready, prescription: { id: "rx", revision: 1, status: "created", reasons: [], createdAt: "2026-10-04T02:00:00.000Z" } };
  expect(nextSteps("prescription", done, patients[0]).at(-1)).toMatchObject({ label: "Prescription recorded", done: true, action: { type: "receipt" } });
  // The receipt never claims a pharmacy got it, and sample mode never claims a hospital record.
  expect(receiptWords(true)).toEqual({ title: "Prescription recorded", where: "in the visit record, not sent to a pharmacy" });
  expect(receiptWords(false)).toEqual({ title: "Sample prescription", where: "on this phone only: no hospital record, no pharmacy" });
});

test("a recorded risk leads as outside the supported case, not something to resolve", () => {
  const risky = { ...base, medicationEntries: confirmed, medicationCheckedRevision: 1, prescriptionInputs: { ...eligible, liverDisease: "yes" } };
  const steps = nextSteps("prescription", risky, patients[0]);
  expect(steps.find(step => !step.done)).toMatchObject({ id: "liverDisease", stop: true, action: { type: "card" } });
  expect(prescribingState(risky, patients[0])).toBe("outside");
});

test("other answers have no step bar", () => {
  expect(nextSteps("briefing", base, patients[0])).toBeUndefined();
});
