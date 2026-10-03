import { expect, test } from "bun:test";

import { appointmentWords, followUpTiming, patientMeds, reviewWords, warningSigns } from "./care";
import { planFor } from "./discharge";

const amelia = planFor({ id: "SYN-1042" });
// One record per condition rule, with and without a penicillin allergy (it swaps the antibiotic).
const others = ["pyelonephritis", "appendicitis", "cellulitis", "pneumonia", "heart failure", "stroke"]
  .flatMap((complaint, i) => [{ id: `SYN-9${i}0`, complaint }, { id: `SYN-9${i}1`, complaint, allergies: "Penicillin" }]).map(planFor);

test("Amelia's plan reads in Chinese and Malay, medicine names as written", () => {
  const zh = patientMeds(amelia, "zh");
  expect(zh.changed[0]).toEqual({ name: "Azithromycin", line: "现在改为每天一片，再服两天", take: "每次一片，饭前饭后都可以", at: ["08:00"], doses: 2 });
  expect(zh.stopped[0]!.name).toBe("Salbutamol nebuliser");
  expect(patientMeds(amelia).changed[0]!.line).toBe("Now a tablet once a day, for 2 more days");
  expect(warningSigns(amelia, "ms")).toContain("Bibir atau hujung jari menjadi biru");
  expect(reviewWords(amelia, "zh")).toEqual({ title: "门诊复诊", short: "门诊复诊", why: "看看您肺炎后恢复得怎样" });
});

test("read at a time, Amelia's azithromycin ends with its last dose and then says it is finished; cetirizine carries on", () => {
  const out = "2026-09-26T07:40:00.000Z"; // Sat 15:40 in Malaysia: the 2 doses are Sun and Mon at 08:00
  const during = patientMeds(amelia, "en", { out, now: new Date("2026-09-28T09:00:00+08:00") }).changed[0]!;
  expect(during).toMatchObject({ line: "Now a tablet once a day, for 2 more days", endsAt: new Date("2026-09-28T08:00:00+08:00") });
  expect(during.finished).toBeUndefined();
  const after = patientMeds(amelia, "zh", { out, now: new Date("2026-10-03T09:00:00+08:00") });
  expect(after.changed[0]).toMatchObject({ name: "Azithromycin", line: "疗程已结束，不用再吃", finished: true, endsAt: new Date("2026-09-28T08:00:00+08:00") });
  expect(after.continue[0]).toEqual(patientMeds(amelia, "zh").continue[0]!);
});

test("every condition rule has its own review and warning signs, and every drafted medicine has plain words in Malay and Chinese", () => {
  for (const plan of others) {
    expect(plan.condition).toBeString();
    expect(warningSigns(plan)).not.toEqual(warningSigns(planFor({ id: "SYN-0000" })));
    // A Malay or Chinese line equal to the clinician's instruction means no plain words were found for it.
    for (const lang of ["ms", "zh"] as const) expect(Object.values(patientMeds(plan, lang)).flat().filter(m => plan.meds.some(c => c.detail === m.line))).toEqual([]);
  }
  const surgery = others.find(p => p.condition === "appendicitis")!;
  expect(reviewWords(surgery, "ms").title).toBe("Klinik pembedahan");
  expect(reviewWords(surgery).why).toBe("To check your wounds after the operation");
});

test("a plan with no condition rule gets general words; an unknown instruction reads as written", () => {
  const plan = planFor({ id: "SYN-0000", complaint: "Dizzy spells", medicines: ["Mystery tablet, 1 daily"] });
  expect(reviewWords(plan).why).toBe("To see how you're doing since you went home");
  expect(warningSigns(plan, "zh")).toContain("感觉更差");
  expect(patientMeds({ ...plan, meds: [{ name: "Newdrug", change: "new", detail: "2 mg daily" }] }, "zh").new[0]).toMatchObject({ name: "Newdrug", line: "2 mg daily" });
});

test("appointment kinds translate their leading words and keep doctors and reasons as written", () => {
  expect(appointmentWords("clinic visit", undefined, "ms")).toEqual({ title: "Lawatan klinik", short: "Lawatan klinik", why: "Temu janji yang telah ditempah" });
  expect(appointmentWords("Visit: Dr. Lim, Respiratory", undefined, "zh").title).toBe("就诊: Dr. Lim, Respiratory");
  expect(appointmentWords("Clinic review · breathless · Dr. Lim", undefined, "zh").title).toBe("门诊复诊 · breathless · Dr. Lim");
  expect(appointmentWords("recall: CT chest", "nodule", "zh")).toEqual({ title: "胸部CT扫描", short: "CT扫描", why: "检查肺部X光上的小阴影" });
  expect(appointmentWords("recall: CT chest", "nodule")).toEqual({ title: "CT scan of your chest", short: "CT scan", why: "To check the small spot on your lung X-ray" });
});

test("a visit is due soon all through its own day, then attended or missed once the day has ended", () => {
  const visit = new Date("2026-10-10T09:00:00+08:00");
  expect(followUpTiming(visit, new Date("2026-10-10T23:59:00+08:00"))).toEqual({ inDays: 0, status: "due-soon" });
  expect(followUpTiming(visit, new Date("2026-10-11T00:01:00+08:00"))).toEqual({ inDays: -1, status: "missed" });
  expect(followUpTiming(visit, new Date("2026-10-11T00:01:00+08:00"), true)).toEqual({ inDays: -1, status: "attended" });
});
