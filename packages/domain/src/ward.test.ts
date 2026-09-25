import { expect, test } from "bun:test";
import { bedBlockers } from "./ward";

test("a bed with nothing cleared lists every blocker with a stable id and kind", () => {
  const blockers = bedBlockers({
    admissionId: "adm-6", gl: { status: "requested", claimStatus: "sent" }, medsConfirmed: false, followUpBooked: false,
    pendingResults: [{ id: "lab-9", test: "Urine culture sensitivities", expected: "12:00" }],
  });
  expect(blockers).toEqual([
    { id: "adm-6-gl", kind: "gl", label: "Final guarantee letter", detail: "Sent · awaiting insurer" },
    { id: "adm-6-meds", kind: "pharmacy", label: "Take-home medicines", detail: "Not yet confirmed" },
    { id: "adm-6-followup", kind: "booking", label: "Follow-up booking", detail: "Clinic review not booked" },
    { id: "adm-6-result-lab-9", kind: "result", label: "Urine culture sensitivities", detail: "Expected by 12:00" },
  ]);
});

test("a received guarantee letter, confirmed medicines and a booked follow-up leave no blockers", () => {
  expect(bedBlockers({ admissionId: "adm-6", gl: { status: "received" }, medsConfirmed: true, followUpBooked: true, pendingResults: [] })).toEqual([]);
});

test("a self-pay admission with no guarantee letter is not blocked on one; an unsent claim reads as codes to review", () => {
  expect(bedBlockers({ admissionId: "adm-2", medsConfirmed: true, followUpBooked: true, pendingResults: [] })).toEqual([]);
  expect(bedBlockers({ admissionId: "adm-2", gl: { status: "requested" }, medsConfirmed: true, followUpBooked: true, pendingResults: [{ id: "r1", test: "Renal function" }] })).toEqual([
    { id: "adm-2-gl", kind: "gl", label: "Final guarantee letter", detail: "Codes ready to review" },
    { id: "adm-2-result-r1", kind: "result", label: "Renal function", detail: "Pending" },
  ]);
});
