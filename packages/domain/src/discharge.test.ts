import { expect, test } from "bun:test";
import { EMPTY_DISCHARGE, decideDischarge, planFor } from "./discharge";
import type { Patient } from "./types";

const plan = planFor({} as Patient);
const command = { encounterId: "visit-1042", requestId: "req-1", approvedBy: "dr.aisyah" };
const fitAt = new Date("2026-09-26T09:00:00Z");
const at = new Date("2026-09-26T09:40:00Z");

test("discharge is refused while blockers are open, naming each one", () => {
  const r = decideDischarge({ ...EMPTY_DISCHARGE, medsConfirmed: true }, plan, command, fitAt, at);
  expect(r).toEqual({ status: "refused", reason: "blocked", open: ["Final guarantee letter", "Follow-up booked"] });
});

const clear = { ...EMPTY_DISCHARGE, glReceived: true, medsConfirmed: true, followUp: "2w" as const };

test("discharge without a named approver is refused even when nothing blocks it", () => {
  expect(decideDischarge(clear, plan, { ...command, approvedBy: "  " }, fitAt, at)).toEqual({ status: "refused", reason: "unapproved", open: [] });
});

test("an approved, unblocked discharge frees the bed 235 minutes ahead of the 275-minute typical wait", () => {
  expect(decideDischarge(clear, plan, command, fitAt, at)).toEqual({
    status: "discharged", encounterId: "visit-1042", requestId: "req-1", approvedBy: "dr.aisyah", dischargedAt: "2026-09-26T09:40:00.000Z", savedMinutes: 235,
  });
});
