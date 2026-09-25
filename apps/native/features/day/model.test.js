import { expect, test } from "bun:test";
import { patients } from "@/features/encounter/fixtures";
import { rankDay } from "./model";

// Demo visits follow the clock; test from 30 minutes before the first one.
const [h, m] = patients[0].time.split(":").map(Number);
const before = h * 60 + m - 30;

test("the unactioned result leads, then the prescribing blocker, and every item has a reason", () => {
  const items = rankDay(patients, {}, before);
  expect(items[0].kind).toBe("result");
  expect(items[0].reason).toContain("no action");
  expect(items[1].kind).toBe("blocker");
  expect(items.every(item => item.reason.length > 0)).toBe(true);
});

test("a reviewed result drops out; confirmed medicines clear the blocker", () => {
  const medicationEntries = [{ id: "medicine-0", name: "A", ingredient: "salbutamol", formulation: "inhaler", confirmed: true }, { id: "medicine-1", name: "B", ingredient: "cetirizine", formulation: "tablet", confirmed: true }];
  const encounter = { revision: 1, cards: [], requests: [], note: "", noteReviewed: false, transcript: [], recording: "idle", recordingSeconds: 0, language: "english", tasks: [], medicationEntries };
  const items = rankDay(patients, { "SYN-1042": encounter }, before, new Set(["result"]));
  expect(items.some(item => item.kind === "result" || item.kind === "blocker")).toBe(false);
});
