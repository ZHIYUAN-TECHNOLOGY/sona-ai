import { expect, test } from "bun:test";
import { dueDate, findingLine, followUpLine, isOverdue, readBoxes, ruleFor, type FollowUpRule } from "./findings";

// The rows of data/follow-up-rules.csv.
const source = "synthetic demo table";
const RULES: FollowUpRule[] = [
  { id: "nodule-under-6", kind: "nodule", riskBand: "low", minMm: 0, maxMm: 5.9, intervalDays: null, action: "No routine follow-up", source },
  { id: "nodule-6-to-8", kind: "nodule", riskBand: "intermediate", minMm: 6, maxMm: 8, intervalDays: 180, action: "CT chest at 6 to 12 months", source },
  { id: "nodule-over-8", kind: "nodule", riskBand: "high", minMm: 8.1, maxMm: 100, intervalDays: 90, action: "CT chest at 3 months, PET-CT or tissue sampling", source },
  { id: "cardiomegaly-borderline", kind: "cardiomegaly", riskBand: "intermediate", minMm: null, maxMm: null, intervalDays: 42, action: "Echocardiogram", source },
];
const location = { x: 0.3, y: 0.3, zone: "right upper zone" };
const nodule = (sizeMm: number) => ({ kind: "nodule" as const, label: `${sizeMm} mm nodule`, sizeMm, location });

test("a nodule's rule is picked by its size: 9 mm is high risk with a 90-day CT, under 6 mm needs no routine follow-up", () => {
  expect(ruleFor(nodule(9), RULES)).toMatchObject({ id: "nodule-over-8", riskBand: "high", intervalDays: 90 });
  expect(ruleFor(nodule(7), RULES)?.id).toBe("nodule-6-to-8");
  expect(ruleFor(nodule(4), RULES)).toMatchObject({ id: "nodule-under-6", riskBand: "low", intervalDays: null });
  // Just over 8 mm is over 8, not between bands.
  expect(ruleFor(nodule(8.05), RULES)?.id).toBe("nodule-over-8");
  // A nodule a model saw but did not size is not "under 6 mm": it has no rule until someone measures it.
  expect(ruleFor({ kind: "nodule", label: "Nodule, right upper zone", location }, RULES)).toBeUndefined();
});

test("any other finding's rule is picked by its kind, and a kind without a rule has none", () => {
  expect(ruleFor({ kind: "cardiomegaly", label: "Borderline heart size", location }, RULES)?.id).toBe("cardiomegaly-borderline");
  expect(ruleFor({ kind: "effusion", label: "Small effusion", location }, RULES)).toBeUndefined();
});

const seen = new Date("2026-09-26T10:00:00+08:00");

test("the due date is the rule's interval after the finding was seen, and a rule without an interval has none", () => {
  expect(dueDate(RULES[2]!, seen)).toEqual(new Date("2026-12-25T10:00:00+08:00"));
  expect(dueDate(RULES[0]!, seen)).toBeUndefined();
});

test("only a tracked finding past its due date is overdue", () => {
  const due = new Date("2026-12-25T10:00:00+08:00");
  const after = new Date("2026-12-26T09:00:00+08:00");
  expect(isOverdue({ status: "tracked", dueAt: due }, after)).toBe(true);
  expect(isOverdue({ status: "tracked", dueAt: due }, seen)).toBe(false);
  // An open finding is a blocker, not an overdue follow-up; a dismissed one is done with.
  expect(isOverdue({ status: "open", dueAt: due }, after)).toBe(false);
  expect(isOverdue({ status: "dismissed", dueAt: due }, after)).toBe(false);
});

test("a finding reads as one short follow-up line, and as a handover line naming what to follow up", () => {
  const nine = { label: "9 mm nodule, right upper zone", action: RULES[2]!.action, dueAt: new Date("2026-12-25T10:00:00+08:00") };
  expect(followUpLine(nine)).toBe("CT chest at 3 months, PET-CT or tissue sampling · due 25 Dec");
  expect(findingLine(nine)).toBe("Follow up 9 mm nodule: CT chest at 3 months · due 25 Dec");
  expect(findingLine({ label: "Borderline heart size", action: "Echocardiogram", dueAt: null })).toBe("Follow up borderline heart size: Echocardiogram");
});

// MedGemma 1.5 answers localisation prompts with a JSON list of { label, box_2d: [y0, x0, y1, x1] }, normalised 0 to 1.
test("a model's boxes become findings: kind from the label, centre and zone from the box, size only when stated", () => {
  const reply = '```json\n[{"label":"9 mm nodule","box_2d":[0.26,0.28,0.34,0.38]},{"label":"Cardiomegaly","box_2d":[0.45,0.38,0.8,0.74]}]\n```';
  expect(readBoxes(reply)).toEqual([
    { kind: "nodule", label: "9 mm nodule", sizeMm: 9, location: { x: 0.33, y: 0.3, zone: "right upper zone", box: [0.26, 0.28, 0.34, 0.38] } },
    { kind: "cardiomegaly", label: "Cardiomegaly", location: { x: 0.56, y: 0.625, zone: "cardiac silhouette", box: [0.45, 0.38, 0.8, 0.74] } },
  ]);
});

test("a box outside the image, turned inside out, or a finding kind we have no rule for is dropped, not guessed", () => {
  expect(readBoxes('[{"label":"nodule","box_2d":[0.5,0.5,0.4,0.6]},{"label":"nodule","box_2d":[0,0,1.4,0.2]},{"label":"rib fracture","box_2d":[0.1,0.1,0.2,0.2]}]')).toEqual([]);
  expect(readBoxes("I cannot localise findings on this image.")).toEqual([]);
});

test("a left lower effusion is named from the patient's side (image right is the patient's left)", () => {
  expect(readBoxes('[{"label":"small pleural effusion","box_2d":[0.7,0.62,0.88,0.9]}]')[0]?.location.zone).toBe("left lower zone");
});

// MedGemma 1.5 answers in thousandths; these are its own boxes from live reads (1 Oct 2026).
test("thousandths are read on their scale; a box the wrong size or place for its kind, or contradicting its zone words, is dropped", () => {
  expect(readBoxes('Final Answer: ```json[{"box_2d": [180, 500, 830, 870], "label": "Left pleural effusion"}]```', 1000)).toEqual([
    { kind: "effusion", label: "Left pleural effusion", location: { x: 0.685, y: 0.505, zone: "left middle zone", box: [0.18, 0.5, 0.83, 0.87] } },
  ]);
  expect(readBoxes('[{"box_2d": [350, 450, 770, 750], "label": "Enlarged heart (cardiomegaly)"}]', 1000)[0]?.location.zone).toBe("cardiac silhouette");
  for (const wrong of [
    '[{"box_2d": [0, 100, 1000, 950], "label": "cardiomegaly"}]', // the whole film is not a heart
    '[{"box_2d": [270, 150, 440, 550], "label": "cardiomegaly"}]', // the right upper lung is not a heart either
    '[{"box_2d": [500, 150, 750, 550], "label": "left pleural effusion"}]', // on the patient's right
    '[{"box_2d": [100, 600, 400, 900], "label": "9 mm nodule, left upper zone"}]', // a third of the film is no nodule
    '[{"box_2d": [700, 200, 760, 260], "label": "9 mm nodule, right upper zone"}]', // it is in the lower zone
  ]) expect(readBoxes(wrong, 1000)).toEqual([]);
  // A box past the scale is off the image, whatever the scale.
  expect(readBoxes('[{"box_2d": [500, 500, 600, 1200], "label": "nodule"}]', 1000)).toEqual([]);
  // Effusions on both sides are one box across the chest; one side's box that wide is not a mark.
  expect(readBoxes('[{"box_2d": [600, 80, 900, 920], "label": "Pleural effusions on both sides"}]', 1000)).toHaveLength(1);
  expect(readBoxes('[{"box_2d": [600, 80, 900, 920], "label": "Left pleural effusion"}]', 1000)).toEqual([]);
});
