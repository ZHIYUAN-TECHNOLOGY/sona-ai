import { expect, test } from "bun:test";
import { patients } from "@/features/encounter/fixtures";
import { fixtureFindings, followUpTask } from "@/features/findings/model";
import { buildHandover, handoverTally } from "./model";

test("only handed-over patients are accepted; discuss ones are counted apart", () => {
  const tally = handoverTally([{ id: "a", decision: "handed" }, { id: "b", decision: "discuss" }, { id: "c", decision: "handed" }, { id: "d", decision: "discuss" }, { id: "e", decision: "handed" }]);
  expect([tally.handed, tally.discuss, tally.line]).toEqual([["a", "c", "e"], ["b", "d"], "3 handed over · 2 to discuss"]);
  expect(tally.receipt("Dr Lim", "14:05")).toBe("Dr Lim accepted 3 patients at 14:05. 2 patients to discuss verbally.");
  const one = handoverTally([{ id: "a", decision: "handed" }]);
  expect([one.line, one.receipt("Dr Lim", "07:30")]).toEqual(["1 handed over", "Dr Lim accepted 1 patient at 07:30."]);
});

test("five cards, watch patients first, open items carried from state", () => {
  const cards = buildHandover(patients, {});
  expect(cards).toHaveLength(5);
  const firstStable = cards.findIndex(card => card.priority === "stable");
  expect(cards.slice(firstStable).every(card => card.priority === "stable")).toBe(true);
  const daniel = cards.find(card => card.patientId === "SYN-1086");
  expect(daniel.recommendation.some(line => line.includes("potassium"))).toBe(true);
  const amelia = cards.find(card => card.patientId === "SYN-1042");
  expect(amelia.recommendation.some(line => line.includes("Confirm 2"))).toBe(true);
});

test("each open or tracked finding is one handover line, never repeated as its task", () => {
  const [nodule, heart] = fixtureFindings(new Date("2026-09-26T10:00:00+08:00"));
  const task = followUpTask(nodule);
  const cards = buildHandover(patients, { "SYN-1042": { tasks: [task] } }, [{ ...nodule, status: "tracked", taskId: task.id }, { ...heart, status: "dismissed" }]);
  const amelia = cards.find(card => card.patientId === "SYN-1042");
  expect(amelia.recommendation.filter(line => line.startsWith("Follow up"))).toEqual(["Follow up 9 mm nodule: CT chest at 3 months · due 25 Dec"]);
});
