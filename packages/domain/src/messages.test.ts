import { expect, test } from "bun:test";
import { DRAFT_MAX, draftByRules, triageByRules } from "./messages";

const label = (text: string) => triageByRules(text).label;

test("emergency words are urgent in English, Malay and Chinese, including breathlessness", () => {
  expect(["I have chest pain since this morning", "I'm breathless walking to the toilet", "Saya sesak nafas", "Sakit dada sejak pagi", "胸痛", "我喘不过气"].map(label))
    .toEqual(["urgent", "urgent", "urgent", "urgent", "urgent", "urgent"]);
  expect(triageByRules("Sakit dada sejak pagi").reason).toBe("Mentions “sakit dada”: possible emergency");
});

test("medicine and symptom questions are clinical; visit, bill, letter and MC questions are admin; unclear goes to a clinician", () => {
  expect(["Can I take paracetamol with my antibiotic?", "Boleh saya makan ubat ini selepas makan?", "我的药要吃几天？", "The cough is still there"].map(label))
    .toEqual(["clinical", "clinical", "clinical", "clinical"]);
  expect(["When is my next appointment?", "Can I get an MC for work?", "Bila temu janji saya?", "Saya perlukan sijil cuti sakit", "我想改一下复诊时间", "Where do I pay the bill?"].map(label))
    .toEqual(["admin", "admin", "admin", "admin", "admin", "admin"]);
  expect(triageByRules("Hello?")).toEqual({ label: "clinical", reason: "Not clearly admin, so a clinician reads it" });
});

const plan = { medicines: [{ name: "Azithromycin", line: "Now a tablet once a day, for 2 more days" }, { name: "Paracetamol", line: "For pain or fever: 1 g every 6 hours if you need it, no more than 4 g a day" }], nextVisit: "Thu 8 Oct, 9:00 AM" };

test("drafts stay within the plan: a named medicine is answered from its own line, otherwise a nurse calls", () => {
  expect(draftByRules({ text: "How long do I take the azithromycin?", label: "clinical", patientFirstName: "Amelia", plan, language: "en" }))
    .toBe("Hi Amelia, about your Azithromycin: Now a tablet once a day, for 2 more days. If anything else worries you, a nurse can call you today.");
  expect(draftByRules({ text: "My cough is worse", label: "clinical", patientFirstName: "Amelia", plan, language: "en" })).toContain("A nurse will call you today");
  expect(draftByRules({ text: "Bila temu janji saya?", label: "admin", patientFirstName: "Amelia", plan, language: "ms" })).toContain("Thu 8 Oct, 9:00 AM");
  expect(draftByRules({ text: "Bila temu janji saya?", label: "admin", patientFirstName: "Amelia", language: "ms" })).toContain("Sona Care");
});

test("urgent drafts send the patient to 999 now in their language, and every draft is short", () => {
  for (const language of ["en", "ms", "zh"] as const) {
    const draft = draftByRules({ text: "胸痛", label: "urgent", patientFirstName: "Amelia", plan, language });
    expect(draft).toContain("999");
    expect(draft.length).toBeLessThanOrEqual(DRAFT_MAX);
  }
  const long = { medicines: [{ name: "Paracetamol", line: "x".repeat(400) }] };
  expect(draftByRules({ text: "paracetamol?", label: "clinical", patientFirstName: "Amelia", plan: long, language: "en" }).length).toBe(DRAFT_MAX);
});
