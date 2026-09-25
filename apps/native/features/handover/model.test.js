import { expect, test } from "bun:test";
import { patients } from "@/features/encounter/fixtures";
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
