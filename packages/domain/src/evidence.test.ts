import { expect, test } from "bun:test";
import { curb65, curb65FromObservations } from "./evidence";
import type { Patient } from "./types";

const patient = (over: Partial<Patient>): Patient => ({ id: "X-1", encounterId: "visit-x", name: "Test Patient", initials: "TP", age: 70, sex: "Female", subtitle: "", time: "09:00", complaint: "", history: [], family: "", social: "", allergies: null, medicines: [], vitals: [], sources: [], incomplete: false, ...over });

test("CURB-65 with nothing charted scores only age and withholds the risk band", () => {
  const r = curb65(patient({ age: 70 }));
  expect(r.recorded).toBe(1);
  expect(r.score).toBe(1);
  expect(r.risk).toBeUndefined();
});

const obs = (kind: "confusion" | "urea" | "respiratory-rate" | "systolic" | "diastolic", value: number, unit: string) => ({ patientId: "SYN-1042", kind, value, unit, sourceId: `obs-${kind}` });
const chart = (amt: number, urea: number, rr: number, sbp: number, dbp: number) =>
  [obs("confusion", amt, "AMT"), obs("urea", urea, "mmol/L"), obs("respiratory-rate", rr, "/min"), obs("systolic", sbp, "mmHg"), obs("diastolic", dbp, "mmHg")];

test("CURB-65 from a fully charted 34-year-old with normal readings scores 0, low risk, each factor citing its reading", () => {
  const r = curb65FromObservations(chart(10, 5.1, 18, 124, 78), 34);
  expect({ score: r.score, recorded: r.recorded, risk: r.risk }).toEqual({ score: 0, recorded: 5, risk: "Low risk · home treatment is usually suitable" });
  expect(r.factors.find(f => f.id === "b")).toMatchObject({ value: "124/78 mmHg", point: false, sources: ["obs-systolic", "obs-diastolic"] });
  expect(r.factors.find(f => f.id === "c")).toMatchObject({ value: "AMT 10/10", point: false, sources: ["obs-confusion"] });
});

test("CURB-65 scores 2 (moderate) for urea 7.5 at age 66, and 5 (severe) when every factor is abnormal", () => {
  const moderate = curb65FromObservations(chart(10, 7.5, 20, 130, 80), 66);
  expect({ score: moderate.score, risk: moderate.risk }).toEqual({ score: 2, risk: "Moderate risk · consider admission" });
  const severe = curb65FromObservations(chart(7, 8.2, 32, 88, 58), 70);
  expect({ score: severe.score, risk: severe.risk }).toEqual({ score: 5, risk: "High risk · manage as severe" });
});

test("CURB-65 keeps unrecorded or wrongly-united factors unknown and withholds the band; a low diastolic alone still scores", () => {
  const r = curb65FromObservations([obs("diastolic", 58, "mmHg"), obs("urea", 45, "mg/dL")], 70);
  expect({ score: r.score, recorded: r.recorded, risk: r.risk }).toEqual({ score: 2, recorded: 2, risk: undefined });
  expect(r.factors.find(f => f.id === "u")?.point).toBeUndefined();
});
