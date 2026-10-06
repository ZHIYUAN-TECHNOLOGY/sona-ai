// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { homeFor, navFor } from "./nav";

const pages = (role: Parameters<typeof navFor>[0]) => navFor(role).flatMap(group => group.items.map(item => item.to.replace("/pro/", "")));

test("a role is only shown the pages whose job it can do", () => {
  expect(pages("bed-manager")).toEqual(["tasks", "ward", "settings"]);
  expect(pages("nurse")).toEqual(["today", "schedule", "tasks", "patients", "visit", "results", "xray", "evidence", "messages", "review", "ward", "handover", "check-ins", "discharge", "library", "settings"]);
  expect(pages("management")).not.toContain("review");
  expect(pages("management")).toContain("training-data");
  expect(pages("doctor")).not.toContain("training-data");
  expect([homeFor("bed-manager"), homeFor("doctor")]).toEqual(["/pro/ward", "/pro/today"]);
});
