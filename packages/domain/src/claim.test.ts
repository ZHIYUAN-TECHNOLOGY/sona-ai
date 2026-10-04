import { expect, test } from "bun:test";
import { DENIAL_REASONS, EMPTY_CLAIM, ORGANISM_UNKNOWN, appealByRules, claimChecks, decideClaimSend, insurerDecision, ivReason, noteFor } from "./claim";

const command = { encounterId: "visit-1042", requestId: "req-claim-1", approvedBy: "dr.aisyah" };
const at = new Date("2026-09-26T10:00:00Z");

test("a claim is refused while an insurer criterion is open, naming it", () => {
  expect(decideClaimSend(noteFor({ ...EMPTY_CLAIM, organismConfirmed: true }), command, at)).toEqual({ status: "refused", reason: "blocked", open: ["Reason for IV antibiotics"] });
});

test("each criterion is read against the note: met by a sentence it quotes, blocked until one says it, absent when the note does not call for it", () => {
  const note = noteFor(EMPTY_CLAIM);
  expect(claimChecks(note).map(c => [c.id, c.status, c.detail])).toEqual([
    ["severity", "passed", "“Community-acquired pneumonia, CURB-65 0.”"], ["imaging", "passed", "“Chest film: right lower zone consolidation.”"],
    ["organism", "blocked", "J18.9 needs the note to say the organism is unknown"], ["iv", "blocked", "The insurer asks why oral was not used first"],
  ]);
  // A fix is a sentence saved to the note, the IV reason in the doctor's own words.
  const fixed = [...note, ORGANISM_UNKNOWN, ivReason(" She could not swallow. ")];
  expect(claimChecks(fixed).slice(2).map(c => [c.status, c.detail])).toEqual([["passed", "“Organism not identified.”"], ["passed", "“IV first: She could not swallow.”"]]);
  // Once the note is edited as a whole the fixes sit inside a section: each still reads, and only its own sentence is quoted.
  const section = [{ id: "plan", text: `${note.map(s => s.text).join(" ")} Organism not identified. IV first: She could not swallow.` }];
  expect(claimChecks(section).map(c => c.detail)).toEqual(["“Community-acquired pneumonia, CURB-65 0.”", "“Chest film: right lower zone consolidation.”", "“Organism not identified.”", "“IV first: She could not swallow.”"]);
  expect(claimChecks([{ id: "s1", text: "Home tomorrow. IV ceftriaxone because she was vomiting." }]).find(c => c.id === "iv")).toMatchObject({ status: "passed", detail: "“IV ceftriaxone because she was vomiting.”" });
  // No pneumonia and no IV in the note: neither of those two is asked. No note at all: nothing is met.
  expect(claimChecks([{ id: "s1", text: "Renal ultrasound: no obstruction. qSOFA 0." }]).map(c => [c.id, c.status])).toEqual([["severity", "passed"], ["imaging", "passed"]]);
  expect(claimChecks([]).map(c => [c.id, c.status, c.detail])).toEqual([["severity", "blocked", "No severity score in the note"], ["imaging", "blocked", "No imaging result in the note"]]);
  expect(decideClaimSend([], command, at)).toMatchObject({ status: "refused", reason: "blocked" });
});

test("a claim with every criterion met is still refused without an approver", () => {
  const ready = noteFor({ ...EMPTY_CLAIM, organismConfirmed: true, ivReasonAdded: true });
  expect(decideClaimSend(ready, { ...command, approvedBy: "" }, at)).toEqual({ status: "refused", reason: "unapproved", open: [] });
});

test("an approved claim with every criterion met is sent", () => {
  const ready = noteFor({ ...EMPTY_CLAIM, organismConfirmed: true, ivReasonAdded: true });
  expect(decideClaimSend(ready, command, at)).toEqual({ status: "sent", encounterId: "visit-1042", requestId: "req-claim-1", approvedBy: "dr.aisyah", sentAt: "2026-09-26T10:00:00.000Z" });
});

test("the mock insurer approves exactly one minute after sending", () => {
  expect(insurerDecision(at, new Date("2026-09-26T10:00:59Z"))).toEqual({ status: "pending", approvesAt: "2026-09-26T10:01:00.000Z" });
  expect(insurerDecision(at, new Date("2026-09-26T10:05:00Z"))).toEqual({ status: "approved", approvedAt: "2026-09-26T10:01:00.000Z" });
});

test("each denial gets a calm appeal whose every point cites a real sentence of the note; a point the note cannot back is left out", () => {
  const note = noteFor({ ...EMPTY_CLAIM, organismConfirmed: true, ivReasonAdded: true });
  const ids = new Set(note.map(s => s.id));
  for (const { code, reason } of DENIAL_REASONS) {
    const letter = appealByRules({ denialCode: code, denialReason: reason, sentences: note, patient: { name: "Amelia Tan" } });
    expect(letter.opening).toContain(reason);
    expect(letter.points.length).toBeGreaterThanOrEqual(2);
    expect(letter.points.every(p => ids.has(p.evidenceSentenceId))).toBe(true);
  }
  // Without the organism sentence, the documentation appeal does not claim it.
  const bare = appealByRules({ denialCode: "DOC", denialReason: "x", sentences: noteFor(EMPTY_CLAIM), patient: { name: "Amelia Tan" } });
  expect(bare.points.map(p => p.evidenceSentenceId)).toEqual(["diagnosis", "xray"]);
});
