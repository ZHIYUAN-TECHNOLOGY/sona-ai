// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { type Answer, answerBy, answerFilm, apply, leadFilm, newTurn, sampleLabel, threadOf } from "./thread";

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

test("a film leads the answer only when it is the first source and the answer cites it", () => {
  const film = { n: 1, id: "enc-1", kind: "image", design: "Imaging", title: "Chest X-ray: Amelia Tan, 3 Oct 2026", year: 2026, text: "Clear lungs.", encounterId: "enc-1" } as const;
  const study = { n: 1, id: "blum", kind: "study", design: "Trial", title: "Prednisone in CAP", year: 2015, text: "" } as const;
  const cites = (...n: number[]) => [{ cites: n }];
  expect(leadFilm([film, { ...study, n: 2 }], cites(1, 2))).toBe(1);
  expect(leadFilm([study, { ...film, n: 2 }], cites(1, 2))).toBeUndefined();
  expect(leadFilm([], [])).toBeUndefined();
  // Ranked first but not cited: the film stays a source, never opened for the clinician.
  expect(leadFilm([film, { ...study, n: 2 }], cites(2))).toBeUndefined();
  expect(leadFilm([film], [])).toBeUndefined();
  // In place, the film needs its visit: a leading image without one is text only.
  expect(answerFilm([film, { ...study, n: 2 }], cites(1))).toBe(film);
  expect(answerFilm([film, { ...study, n: 2 }], cites(2))).toBeUndefined();
  expect(answerFilm([study, { ...film, n: 2 }], cites(2))).toBeUndefined();
  expect(answerFilm([{ ...film, encounterId: undefined }], cites(1))).toBeUndefined();
});

test("a sample says it is a sample, and when the model is starting", () => {
  expect(sampleLabel({ source: "gemma" })).toBeUndefined();
  expect(sampleLabel({ source: "fixture" })).toBe("Sample answer");
  expect(sampleLabel({ source: "fixture", waking: 2.2 })).toContain("about 3 min");
});

test("an answer's caption names the model by Sona's name, never its id", () => {
  expect(answerBy({ source: "gemma-4-26b-a4b" })).toBe("Sona Med");
  expect(answerBy({ source: "fixture" })).toBe("Sample answer");
});
