// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { type Answer, apply, newTurn, phaseOf } from "./thread";

const claim = { text: "Steroids are not routine.", cites: [1] };
const answer = { bottomLine: "Not routinely.", claims: [claim], references: [], source: "gemma" } as unknown as Answer;

test("a turn's phase follows its stream: search, read, write, done", () => {
  let turn = newTurn("a", "Steroids for CAP?");
  expect(phaseOf(turn)).toBe("search");
  turn = apply(turn, { type: "step", step: "read", studies: 1, passages: 0, references: [] });
  expect(phaseOf(turn)).toBe("read");
  expect(phaseOf(apply(turn, { type: "step", step: "write" }))).toBe("write");
  expect(phaseOf(apply(turn, { type: "claim", claim }))).toBe("write");
  expect(phaseOf(apply(turn, { type: "answer", answer }))).toBe("done");
  expect(phaseOf({ ...turn, failed: "No" })).toBe("done");
});
