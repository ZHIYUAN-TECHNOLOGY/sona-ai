import { expect, test } from "bun:test";
import { marked, medicinesOf } from "./terms";

const marks = (text, medicines) => marked(text, medicines).filter(p => p.mark).map(p => `${p.mark}:${p.text}`);

test("an answer's medicines, how much and when, and warning signs, in English, Malay and Chinese", () => {
  expect(marks("Take paracetamol 1 g every 6 hours if you need it, no more than 4 g a day.")).toEqual(["medicine:paracetamol", "dose:1 g", "dose:every 6 hours", "dose:4 g"]);
  expect(marks("Take 1 tablet of azithromycin once a day after meals for 2 more days.")).toEqual(["dose:1 tablet", "medicine:azithromycin", "dose:once a day", "dose:after meals", "dose:for 2 more days"]);
  expect(marks("If you have chest pain or shortness of breath, call 999.")).toEqual(["warning:chest pain", "warning:shortness of breath", "warning:call 999"]);
  expect(marks("You are allergic to penicillin.")).toEqual(["warning:allergic", "medicine:penicillin"]);
  expect(marks("Makan metformin 500 mg dua kali sehari selepas makan. Jika sesak nafas, pergi ke kecemasan.")).toEqual(["medicine:metformin", "dose:500 mg", "dose:dua kali sehari", "dose:selepas makan", "warning:sesak nafas", "warning:kecemasan"]);
  expect(marks("扑热息痛每六小时一克，饭后吃。如果胸痛或呼吸困难，请打999。")).toEqual(["medicine:扑热息痛", "dose:每六小时", "dose:一克", "dose:饭后", "warning:胸痛", "warning:呼吸困难", "warning:999"]);
});

test("her own medicines from the plan, even names no list knows; nothing in a plain line; the pieces rebuild the text", () => {
  const plan = { medicines: { new: [{ name: "Salbutamol nebuliser" }], continue: [{ name: "Zyrtec" }], stopped: [] } };
  expect(medicinesOf(plan)).toEqual(["Salbutamol nebuliser", "Salbutamol", "Zyrtec"]);
  expect(marks("Keep taking Zyrtec at night; the Salbutamol nebuliser is stopped.", medicinesOf(plan))).toEqual(["medicine:Zyrtec", "dose:at night", "medicine:Salbutamol nebuliser"]);
  expect(marks("See you at your visit in April. Rest well and drink water.")).toEqual([]);
  const text = "Take 2 tablets twice a day; if you faint, go to A&E.";
  expect(marked(text).map(p => p.text).join("")).toBe(text);
  expect(medicinesOf(undefined)).toEqual([]);
});

test("the next visit and its date, as \"when\": Sona Care's own answer of 10 Oct, Malay and Chinese", () => {
  expect(marks("Your next visit is a clinic review scheduled for Saturday, October 24, 2026. You also have check-ins scheduled for day 2 and day 7 after your discharge."))
    .toEqual(["dose:clinic review", "dose:Saturday, October 24, 2026", "dose:check-ins", "dose:day 2 and day 7"]);
  expect(marks("Take paracetamol every 4 to 6 hours.")).toEqual(["medicine:paracetamol", "dose:every 4 to 6 hours"]);
  expect(marks("Temujanji klinik anda pada Sabtu, 24 Oktober 2026.")).toEqual(["dose:Temujanji klinik", "dose:Sabtu, 24 Oktober 2026"]);
  expect(marks("您的复诊在10月24日星期六。")).toEqual(["dose:复诊", "dose:10月24日", "dose:星期六"]);
});

test("the model's own marks win, found in turn so a dose said twice is marked twice; none chosen colours nothing", () => {
  const text = "Take 1 g every 6 hours. Your record says 1 g if you need it, and call 999 if you faint.";
  const chosen = [{ text: "1 g", kind: "dose" }, { text: "every 6 hours", kind: "dose" }, { text: "1 g", kind: "dose" }, { text: "call 999", kind: "warning" }, { text: "not in it", kind: "medicine" }];
  expect(marked(text, [], chosen).filter(p => p.mark).map(p => `${p.mark}:${p.text}`)).toEqual(["dose:1 g", "dose:every 6 hours", "dose:1 g", "warning:call 999"]);
  expect(marked(text, [], []).filter(p => p.mark)).toEqual([]);
  expect(marked(text, [], chosen).map(p => p.text).join("")).toBe(text);
});
