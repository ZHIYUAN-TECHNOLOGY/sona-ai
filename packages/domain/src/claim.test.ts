import { expect, test } from "bun:test";
import { EMPTY_CLAIM, decideClaimSend, insurerDecision } from "./claim";

const command = { encounterId: "visit-1042", requestId: "req-claim-1", approvedBy: "dr.aisyah" };
const at = new Date("2026-09-26T10:00:00Z");

test("a claim is refused while an insurer criterion is open, naming it", () => {
  expect(decideClaimSend({ ...EMPTY_CLAIM, organismConfirmed: true }, command, at)).toEqual({ status: "refused", reason: "blocked", open: ["Reason for IV antibiotics"] });
});

test("a claim with every criterion met is still refused without an approver", () => {
  const ready = { ...EMPTY_CLAIM, organismConfirmed: true, ivReasonAdded: true };
  expect(decideClaimSend(ready, { ...command, approvedBy: "" }, at)).toEqual({ status: "refused", reason: "unapproved", open: [] });
});

test("an approved claim with every criterion met is sent", () => {
  const ready = { ...EMPTY_CLAIM, organismConfirmed: true, ivReasonAdded: true };
  expect(decideClaimSend(ready, command, at)).toEqual({ status: "sent", encounterId: "visit-1042", requestId: "req-claim-1", approvedBy: "dr.aisyah", sentAt: "2026-09-26T10:00:00.000Z" });
});

test("the mock insurer approves exactly one minute after sending", () => {
  expect(insurerDecision(at, new Date("2026-09-26T10:00:59Z"))).toEqual({ status: "pending", approvesAt: "2026-09-26T10:01:00.000Z" });
  expect(insurerDecision(at, new Date("2026-09-26T10:05:00Z"))).toEqual({ status: "approved", approvedAt: "2026-09-26T10:01:00.000Z" });
});
