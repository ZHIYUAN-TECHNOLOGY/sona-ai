// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { pageRange, tabForKey } from "./primitives";

test("tabs wrap with the arrow keys and ignore other keys", () => {
  const ids = ["a", "b", "c"];
  expect(tabForKey(ids, "c", "ArrowRight")).toBe("a");
  expect(tabForKey(ids, "a", "ArrowLeft")).toBe("c");
  expect(tabForKey(ids, "b", "End")).toBe("c");
  expect(tabForKey(ids, "b", "Enter")).toBeUndefined();
});

test("the pager's range stops at the total", () => {
  expect(pageRange(5, 10, 42)).toEqual([41, 42]);
  expect(pageRange(1, 10, 0)).toEqual([0, 0]);
});
