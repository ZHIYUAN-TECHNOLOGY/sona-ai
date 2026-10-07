// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { flaggedFirst } from "./rank";

test("flagged items come first and the rest keep their order", () => {
  const rows = [{ id: "a", failing: [] }, { id: "b", failing: ["x"] }, { id: "c", failing: [] }, { id: "d", failing: ["y", "z"] }];
  expect(flaggedFirst(rows).map(r => r.id)).toEqual(["b", "d", "a", "c"]);
});
