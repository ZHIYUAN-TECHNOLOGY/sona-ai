// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { splitMarkers } from "./markers";

test("a [n] marker for a known source becomes a link part; an unknown one stays text", () => {
  expect(splitMarkers("Take it daily [1]. See us [9] soon [2]", [1, 2])).toEqual(["Take it daily ", { n: 1 }, ". See us [9] soon ", { n: 2 }]);
  expect(splitMarkers("No markers", [1])).toEqual(["No markers"]);
});
