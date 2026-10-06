// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { dateOf, firstSentence, leadOf, openOf, paragraphsOf, type Summary } from "./model";

const s = (id: string, at: string, text: string, whatChanged: string[] = []): Summary => ({ id, at, text, whatChanged });
const newest = s("b", "2026-10-06T02:00:00Z", "Your chest is clear. Keep taking your tablets. Come back in two weeks.", ["New tablet", "Blood test", "Visit in two weeks"]);
const older = s("a", "2026-09-01T02:00:00Z", "All well.");

test("the lead counts what changed, dates the visit and quotes the first sentence", () => {
  expect(leadOf(newest, "en-MY")).toBe("3 things changed after your visit on 6 Oct. Your chest is clear.");
  expect(leadOf({ ...newest, whatChanged: ["New tablet"] }, "en-MY")).toStartWith("1 thing changed");
  expect(leadOf(older, "en-MY")).toMatch(/^Your summary from your visit on 1 Sept? is ready\. All well\.$/);
});

test("a date is the Malaysia day, not the UTC day", () => {
  expect(dateOf("2026-10-05T17:00:00Z", "en-MY")).toBe("6 Oct");
});

test("text is cut into short paragraphs, keeping the writer's own when there are any", () => {
  expect(paragraphsOf(newest.text)).toEqual(["Your chest is clear. Keep taking your tablets.", "Come back in two weeks."]);
  expect(paragraphsOf("One. Two. Three.\n\nFour.")).toEqual(["One. Two. Three.", "Four."]);
  expect(firstSentence("")).toBe("");
});

test("a link's id opens that summary; an unknown or missing id opens the newest", () => {
  expect(openOf([newest, older], "a")).toBe(older);
  expect(openOf([newest, older], "nope")).toBe(newest);
  expect(openOf([newest, older])).toBe(newest);
  expect(openOf([], "a")).toBeUndefined();
});
