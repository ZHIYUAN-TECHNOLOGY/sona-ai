import { expect, test } from "bun:test";
import { newEncounter } from "@/features/encounter/fixtures";
import { EMPTY_CLAIM } from "@/features/claim/model";
import { formatRM, openItems, shortRM, totalRisk } from "./model";

test("twelve notes and about RM 19k at risk before anything is sent", () => {
  const items = openItems({}, new Set());
  expect(items).toHaveLength(12);
  expect(totalRisk(items)).toBe(19230);
  expect(formatRM(19230)).toBe("RM 19,230");
  expect(shortRM(19230)).toBe("RM 19k");
  expect(shortRM(630)).toBe("RM 630");
});

test("sent queries and the flow 2 organism fix both clear rows", () => {
  expect(openItems({}, new Set(["a-tan"])).map(i => i.id)).not.toContain("a-tan");
  const fixed = { ...newEncounter(), claim: { ...EMPTY_CLAIM, organismConfirmed: true } };
  const items = openItems({ "SYN-1042": fixed }, new Set());
  expect(items).toHaveLength(11);
  expect(totalRisk(items)).toBe(17810);
});
