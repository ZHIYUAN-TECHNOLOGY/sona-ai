import { expect, test } from "bun:test";
import { newEncounter } from "@/features/encounter/fixtures";
import { CODES, EMPTY_CLAIM, ORGANISM_UNKNOWN, approveClaim, claimChecks, ivReason, noteFor, withFix } from "./model";

test("two insurer gaps block until fixed, and each fix adds its sentence to the note", () => {
  expect(claimChecks(noteFor(EMPTY_CLAIM)).filter(c => c.status === "blocked").map(c => c.id)).toEqual(["organism", "iv"]);
  const fixed = { ...EMPTY_CLAIM, organismConfirmed: true, ivReasonAdded: true };
  expect(claimChecks(noteFor(fixed)).every(c => c.status === "passed")).toBe(true);
  expect(noteFor(fixed).length).toBe(noteFor(EMPTY_CLAIM).length + 2);
});

test("connected, a fix is a sentence saved to the visit's note: the criteria read the note, and a second answer replaces the first", () => {
  const saved = [{ id: "assessment", text: "Community-acquired pneumonia, CURB-65 1. Chest X-ray: left lower zone consolidation." }, { id: "plan", text: "IV ceftriaxone." }];
  expect(claimChecks(saved).map(c => [c.id, c.status])).toEqual([["severity", "passed"], ["imaging", "passed"], ["organism", "blocked"], ["iv", "blocked"]]);
  const fixed = withFix(withFix(withFix(saved, ORGANISM_UNKNOWN), ivReason("first try")), ivReason("she could not keep tablets down"));
  expect(fixed.map(s => s.id)).toEqual(["assessment", "plan", "organism", "iv"]);
  expect(claimChecks(fixed).find(c => c.id === "iv")).toMatchObject({ status: "passed", detail: "“IV first: she could not keep tablets down”" });
  // No note saved yet: nothing is met, and nothing is quoted.
  expect(claimChecks([]).every(c => c.status === "blocked")).toBe(true);
});

test("every code points at a sentence in the note", () => {
  const ids = new Set(noteFor(EMPTY_CLAIM).map(s => s.id));
  expect(CODES.every(c => ids.has(c.evidence))).toBe(true);
});

test("approval resolves the discharge guarantee letter", () => {
  const approved = approveClaim({ ...newEncounter(), claim: { ...EMPTY_CLAIM, status: "sent" } }, new Date(2026, 8, 26, 9, 0));
  expect(approved.claim.status).toBe("approved");
  expect(approved.discharge.glReceived).toBe(true);
});
