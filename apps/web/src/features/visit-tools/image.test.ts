// @ts-ignore -- apps/web has no Bun types installed; drop this line once @types/bun is a devDependency.
import { expect, test } from "bun:test";

import { fit } from "./image";
import { checkedCount } from "./draft";

test("fit caps the longest side and never enlarges", () => {
  expect(fit(4000, 3000)).toEqual({ width: 2000, height: 1500 });
  expect(fit(800, 600)).toEqual({ width: 800, height: 600 });
});

test("checkedCount counts only ticked items with words in them", () => {
  const item = (on: boolean, text: string) => ({ on, text });
  expect(checkedCount({
    sections: { history: item(true, "Cough"), examination: item(true, "  "), assessment: item(false, "CAP"), plan: item(true, "PO") },
    medicines: [{ on: true, name: "Clarithromycin", change: "new", confidence: "high" }, { on: false, name: "Salbutamol", change: "changed", confidence: "low" }],
    tasks: [{ on: true, title: "Repeat CXR" }, { on: true, title: "" }],
    followUp: item(true, "2 weeks"),
  })).toBe(5);
});
