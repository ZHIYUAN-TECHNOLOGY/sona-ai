// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { matching, ringgit } from "./filter";

test("search matches every word across fields, any case", () => {
  const rows = [{ a: "Aminah", b: "D64.9" }, { a: "Tan", b: "E11" }];
  expect(matching(rows, "  ", r => [r.a, r.b])).toEqual(rows);
  expect(matching(rows, "aminah d64", r => [r.a, r.b])).toEqual([rows[0]!]);
  expect(matching(rows, "aminah e11", r => [r.a, r.b])).toEqual([]);
});

test("ringgit drops the unit", () => expect(ringgit(63000)).toBe("630"));
test("ringgit keeps both sen digits and groups thousands", () => expect([ringgit(128456050), ringgit(100), ringgit(5)]).toEqual(["1,284,560.50", "1", "0.05"]));
