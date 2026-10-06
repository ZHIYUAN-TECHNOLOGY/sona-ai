// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { countOf, dischargeRank, letterHold, standings } from "./rank";

const blocker = (kind: "gl" | "pharmacy") => ({ id: kind, kind, label: kind, detail: "" });
const by = standings([
  { bed: "1", patientId: "watch", name: "W", status: "watch", blockers: [] },
  { bed: "2", patientId: "two", name: "T", status: "fit", blockers: [blocker("gl"), blocker("pharmacy")] },
  { bed: "3", patientId: "ready", name: "R", status: "fit", blockers: [] },
  { bed: "4", patientId: "one", name: "O", status: "fit", blockers: [blocker("pharmacy")] },
  { bed: "5", status: "empty", blockers: [] },
]);

test("ready leads, then the least blocked, then watch, then patients with no bed", () => {
  const ids = ["none", "watch", "two", "ready", "one"].sort((a, b) => dischargeRank(by.get(a)) - dischargeRank(by.get(b)));
  expect(ids).toEqual(["ready", "one", "two", "watch", "none"]);
});

test("counts match the ward's kinds and an empty bed is nobody", () => {
  expect([countOf(by, "fit"), countOf(by, "blocked"), by.size]).toEqual([1, 2, 4]);
});

test("a letter hold is only the guarantee-letter blocker", () => {
  expect([letterHold(by.get("two"))?.kind, letterHold(by.get("one"))]).toEqual(["gl", undefined]);
});
