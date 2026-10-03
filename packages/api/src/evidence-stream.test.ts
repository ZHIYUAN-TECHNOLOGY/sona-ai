import { expect, test } from "bun:test";

import { partialEvidence } from "./evidence-stream";

const whole = JSON.stringify({
  bottomLine: "Not routinely: only \"severe\" pneumonia.",
  claims: [
    { text: "Guideline {says} no.", cites: [1], topic: "evidence", quotes: [{ n: 1, text: "Recommends against." }] },
    { text: "Trial found harm.", cites: [2], topic: "harms" },
  ],
  followUps: ["When?"],
});

test("an answer read while it is written: the bottom line once it closes, each claim once its object closes", () => {
  const cut = (marker: string) => whole.slice(0, whole.indexOf(marker) + marker.length);
  // Mid bottom line: nothing yet.
  expect(partialEvidence(whole.slice(0, 30))).toEqual({ bottomLine: undefined, claims: [] });
  // The bottom line has closed (escaped quotes and all); the first claim is still open, braces inside its text included.
  expect(partialEvidence(cut("Guideline {says"))).toEqual({ bottomLine: 'Not routinely: only "severe" pneumonia.', claims: [] });
  // The first claim has closed.
  expect(partialEvidence(cut('"Recommends against."}]}')).claims).toEqual([{ text: "Guideline {says} no.", cites: [1], topic: "evidence", quotes: [{ n: 1, text: "Recommends against." }] }]);
  // Everything: both claims, and nothing from the follow-ups.
  expect(partialEvidence(whole).claims).toHaveLength(2);
  // A fenced answer reads the same.
  expect(partialEvidence("```json\n" + whole + "\n```").claims).toHaveLength(2);
});
