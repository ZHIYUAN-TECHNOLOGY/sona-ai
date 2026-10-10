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
