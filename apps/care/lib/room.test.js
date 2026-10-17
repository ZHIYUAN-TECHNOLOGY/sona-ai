import { expect, test } from "bun:test";
import { speechBar } from "./room";

/** The reading at which a recording of these levels first counts as speech, and the first of 8 quiet readings after it (0.8 s). */
function turn(levels) {
  let quietest = Infinity, spoke, quiet = 0;
  for (const [i, level] of levels.entries()) {
    quietest = Math.min(quietest, level);
    if (level > speechBar(quietest)) { spoke ??= i; quiet = 0; }
    else if (spoke !== undefined && ++quiet === 8) return { spoke, end: i };
  }
  return { spoke };
}
const hum = n => Array.from({ length: n }, (_, i) => [-36, -33, -35, -31, -34][i % 5]);

test("a quiet room keeps the -38 dBFS bar; a humming one ends the turn 0.8 s after the patient stops", () => {
  expect(turn([-60, -58, -20, -18, -22, ...Array(8).fill(-60)])).toEqual({ spoke: 2, end: 12 });
  // Hum around -33 dBFS is over -38: before, it was speech for good, and the turn never ended by itself.
  expect(turn(hum(30))).toEqual({ spoke: undefined });
  expect(turn([...hum(10), -18, -15, -20, ...hum(10)])).toEqual({ spoke: 10, end: 20 });
  // Talking from the first reading still counts, the bar never above -28 dBFS.
  expect(turn([-20, -24, -19, ...hum(9)])).toEqual({ spoke: 0, end: 10 });
});
