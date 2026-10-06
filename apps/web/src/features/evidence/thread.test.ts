// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { type Answer, apply, newTurn, sampleLabel, threadOf } from "./thread";

const claim = { text: "Steroids are not routine.", cites: [1] };
const answer = { bottomLine: "Not routinely.", claims: [claim], references: [], source: "gemma" } as unknown as Answer;

test("claims arrive one by one and the finished answer replaces them", () => {
  let turn = apply(newTurn("a", "Steroids for CAP?"), { type: "step", step: "read", studies: 1, passages: 2, references: [] });
  expect(turn.step).toBe("Reading the sources · 1 study, 2 library passages");
  turn = apply(turn, { type: "claim", claim });
  expect(turn.claims).toEqual([claim]);
  expect(threadOf([turn])).toEqual([]);
  turn = apply(turn, { type: "answer", answer });
  expect(threadOf([turn])).toEqual([{ question: "Steroids for CAP?", answer: "Not routinely. Steroids are not routine." }]);
  expect(threadOf(Array.from({ length: 6 }, () => turn))).toHaveLength(4);
});

test("a sample says it is a sample, and when the model is starting", () => {
  expect(sampleLabel({ source: "gemma" })).toBeUndefined();
  expect(sampleLabel({ source: "fixture" })).toBe("Sample answer");
  expect(sampleLabel({ source: "fixture", waking: 2.2 })).toContain("about 3 min");
});
