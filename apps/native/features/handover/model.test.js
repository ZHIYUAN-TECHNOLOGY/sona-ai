import { expect, test } from "bun:test";
import { patients } from "@/features/encounter/fixtures";
import { fixtureFindings, followUpTask } from "@/features/findings/model";
import { buildHandover } from "./model";

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
