import { expect, test } from "bun:test";
import { unanswered } from "./judge-answer";

const model = { source: "model", model: "gemma-4" }, stub = { source: "fixture" };

test("outside the judge build every card shows what it shows today", () => {
  for (const answer of [{ loading: true }, { loading: false, error: "The server did not answer" }, { loading: false, data: stub }, { loading: false, data: model }, { loading: false }])
    expect(unanswered(false, answer)).toBeUndefined();
});

test("the judge build shows a model's answer as today", () => {
  expect(unanswered(true, { loading: false, data: model })).toBeUndefined();
  // The answer kept from before a change (the claim's codes after a fix) is still the model's, even if asking again failed.
  expect(unanswered(true, { loading: false, data: model, error: "The server did not answer" })).toBeUndefined();
});

test("the judge build drafts while the model is asked", () => {
  expect(unanswered(true, { loading: true })).toEqual({ why: "drafting" });
});

test("the judge build says a failed call as the server said it", () => {
  expect(unanswered(true, { loading: false, error: "The server did not answer" })).toEqual({ why: "failed", reason: "The server did not answer" });
});

test("the judge build never takes the server's stub for an answer, and says when the model is starting", () => {
  expect(unanswered(true, { loading: false, data: stub })).toEqual({ why: "stub", reason: "Sona's model did not answer" });
  expect(unanswered(true, { loading: false, data: { ...stub, waking: 2.2 } })).toEqual({ why: "stub", reason: "Sona's model is starting, about 3 min" });
  // An answer with no source, or nothing at all, is not a model's either.
  expect(unanswered(true, { loading: false, data: { lines: ["x"] } })?.why).toBe("stub");
  expect(unanswered(true, { loading: false })?.why).toBe("stub");
});
