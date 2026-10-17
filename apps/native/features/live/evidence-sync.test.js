import { expect, mock, test } from "bun:test";

mock.module("@/features/live", () => ({ api: {}, errorText: e => e.message, useLive: () => ({}) }));
const { keeps } = await import("./evidence-sync");

test("only an answer is kept for the session: a failure or a model still starting is asked again on the next open", () => {
  expect(keeps({ source: "gemma-4-26b", enough: true })).toBe(true);
  expect(keeps({ source: "cached", enough: true })).toBe(true);
  // Thin evidence is an answer (the model looked and found too little); the server's stub with no claims is a failure.
  expect(keeps({ source: "gemma-4-26b", enough: false })).toBe(true);
  expect(keeps({ source: "fixture", enough: false })).toBe(false);
  expect(keeps({ source: "fixture", enough: true, waking: 3 })).toBe(false);
});
