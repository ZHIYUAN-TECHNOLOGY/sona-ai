import { fixture, rows } from "./fixture";

// Sona Care Results: care.results.list is unpaginated and every text column is unbounded (lab_results: test, value, unit, flag).
const DAY = 86_400_000, NOW = Date.now();
const at = (days: number) => new Date(NOW - days * DAY);
const done = (id: string, days: number, test: string, value: string, unit?: string, flag?: string) =>
  ({ id, test, at: at(days), released: true as const, acknowledged: true, value, unit, flag });
const waiting = (id: string, days: number, test: string) => ({ id, test, at: at(days), released: false as const, acknowledged: false });

const WORST = [
  waiting("r-1", 0, "Blood culture and sensitivity (aerobic and anaerobic bottles), 2 sets"),
  done("r-2", 1, "Estimated glomerular filtration rate (eGFR, CKD-EPI 2021)", "28", "mL/min/1.73m²", "Low: stage 4 range, discuss at next review"),
  done("r-3", 1, "Troponin T, high-sensitivity", "<0.01", "ng/mL", "normal"),
  done("r-4", 1, "N-terminal pro b-type natriuretic peptide (NT-proBNP)", "12846", "pg/mL", "H"),
  done("r-5", 1, "SARS-CoV-2 RNA (RT-PCR)", "Not detected"),
  done("r-6", 1, "HbA1c", "10.4", "%", "High"),
  done("r-7", 2, "Potassium", "5.9", "mmol/L", "Repeat sample requested (haemolysed)"),
  done("r-8", 2, "Urine microscopy, culture and sensitivity", "Mixed growth of >3 organisms, likely contamination. Please repeat a mid-stream sample.", undefined, "Comment"),
  waiting("r-9", 2, "Histopathology"),
  done("r-10", 3, "eGFR", "35", "mL/min/1.73m²", "Low"),
  ...rows(30, i => {
    const tests = [["Haemoglobin", "g/dL", 11.2], ["White cell count", "x10⁹/L", 9.8], ["Platelets", "x10⁹/L", 212], ["Sodium", "mmol/L", 136], ["Creatinine", "µmol/L", 182], ["Estimated glomerular filtration rate (eGFR, CKD-EPI 2021)", "mL/min/1.73m²", 30]] as const;
    const [test, unit, base] = tests[i % tests.length]!;
    const value = (base * (1 + ((i * 7) % 11 - 5) / 50)).toFixed(base > 100 ? 0 : 1);
    return i % 9 === 4 ? waiting(`r-old-${i}`, 4 + i * 3, test) : done(`r-old-${i}`, 4 + i * 3, test, value, unit, i % 4 === 0 ? (i % 8 ? "Low" : "High") : "normal");
  }),
];

export default [
  fixture("care.results.list", {
    worst: WORST,
    empty: [],
    one: [done("r-1", 1, "Hb", "13", "g/dL", "normal")],
    huge: rows(1000, i => done(`r-${i}`, i / 3, ["Haemoglobin", "Creatinine", "Potassium", "Estimated glomerular filtration rate (eGFR, CKD-EPI 2021)"][i % 4]!, String(4 + (i % 13) / 2), "mmol/L", i % 5 ? "normal" : "High")),
  }),
  fixture("care.results.explain", {
    worst: { text: "您的 eGFR 是 28，比正常范围低，说明肾脏过滤血液的能力下降了。这通常和长期糖尿病、高血压有关，也可能因为最近的利尿剂（Lasix）而暂时变差。这个结果本身不需要您马上做什么，但请不要自己服用止痛药如布洛芬（Ibuprofen），并在下次复诊时让医生检查您的药物剂量。如果您一整天都没有小便，或者脚肿得越来越厉害，请马上联系医院。", source: "fixture", waking: 12 },
    one: { text: "Normal.", source: "model" },
  }),
];
