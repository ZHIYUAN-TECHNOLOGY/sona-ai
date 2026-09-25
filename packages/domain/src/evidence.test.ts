import { expect, test } from "bun:test";
import { curb65 } from "./evidence";
import type { Patient } from "./types";

const patient = (over: Partial<Patient>): Patient => ({ id: "X-1", encounterId: "visit-x", name: "Test Patient", initials: "TP", age: 70, sex: "Female", subtitle: "", time: "09:00", complaint: "", history: [], family: "", social: "", allergies: null, medicines: [], vitals: [], sources: [], incomplete: false, ...over });

test("CURB-65 with nothing charted scores only age and withholds the risk band", () => {
  const r = curb65(patient({ age: 70 }));
  expect(r.recorded).toBe(1);
  expect(r.score).toBe(1);
  expect(r.risk).toBeUndefined();
});
