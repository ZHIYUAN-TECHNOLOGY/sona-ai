import { expect, test } from "bun:test";
import { newEncounter } from "@/features/encounter/fixtures";
import { CODES, EMPTY_CLAIM, approveClaim, claimChecks, noteFor } from "./model";

test("two insurer gaps block until fixed, and each fix adds its sentence to the note", () => {
  expect(claimChecks(EMPTY_CLAIM).filter(c => c.status === "blocked").map(c => c.id)).toEqual(["organism", "iv"]);
  const fixed = { ...EMPTY_CLAIM, organismConfirmed: true, ivReasonAdded: true };
  expect(claimChecks(fixed).every(c => c.status === "passed")).toBe(true);
  expect(noteFor(fixed).length).toBe(noteFor(EMPTY_CLAIM).length + 2);
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
