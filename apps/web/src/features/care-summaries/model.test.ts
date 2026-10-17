// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { dateOf, firstWords, headerLead, insightOf, openOf, paragraphsOf, sectionsOf, type Summary } from "./model";

const s = (id: string, at: string, text: string, whatChanged: string[] = []): Summary => ({ id, at, text, whatChanged });
const newest = s("b", "2026-10-06T02:00:00Z", "Your chest is clear. Keep taking your tablets. Come back in two weeks.", ["New tablet", "Blood test", "Visit in two weeks"]);
const older = s("a", "2026-09-01T02:00:00Z", "All well.");

test("the insight shows what changed, or else the sentences that tell the patient what to do", () => {
  expect(insightOf(newest)).toEqual({ lead: "3 things changed after this visit.", rows: newest.whatChanged, medicine: true });
  const plain = insightOf(s("c", newest.at as string, "BP stable. Take amlodipine 5 mg daily. Return to clinic in 2 weeks. Call us if dizzy. Go home today. Eat well."));
  expect(plain?.rows).toEqual(["Take amlodipine 5 mg daily.", "Return to clinic in 2 weeks.", "Call us if dizzy."]);
  expect(plain?.lead).toBe("3 lines in this summary tell you what happens next.");
  expect(plain?.medicine).toBe(true);
  expect(insightOf(s("d", newest.at as string, "Call us if worse."))?.medicine).toBe(false);
  expect(insightOf(older)).toBeUndefined();
});

test("the header says how many summaries there are and when the latest visit was", () => {
  expect(headerLead([newest], "en-MY")).toBe("1 summary from your care team. Latest: your visit on 6 October.");
  expect(headerLead([newest, older], "en-MY")).toStartWith("2 summaries");
});

test("headings come only from the writer; first words are cut at a word", () => {
  expect(sectionsOf("Plan:\nRest at home.\n\nAll well.")).toEqual([{ heading: "Plan", body: "Rest at home." }, { body: "All well." }]);
  expect(firstWords("Your chest is clear. Keep taking your tablets.", 20)).toBe("Your chest is clear.…");
});

test("a date is the Malaysia day, not the UTC day", () => {
  expect(dateOf("2026-10-05T17:00:00Z", "en-MY")).toBe("6 Oct");
});

test("text is cut into short paragraphs, keeping the writer's own when there are any", () => {
  expect(paragraphsOf(newest.text)).toEqual(["Your chest is clear. Keep taking your tablets.", "Come back in two weeks."]);
  expect(paragraphsOf("One. Two. Three.\n\nFour.")).toEqual(["One. Two. Three.", "Four."]);
});

test("a link's id opens that summary; an unknown or missing id opens the newest", () => {
  expect(openOf([newest, older], "a")).toBe(older);
  expect(openOf([newest, older], "nope")).toBe(newest);
  expect(openOf([newest, older])).toBe(newest);
  expect(openOf([], "a")).toBeUndefined();
});
