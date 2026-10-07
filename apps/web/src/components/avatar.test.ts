// @ts-expect-error bun's test types are not installed in this app
import { expect, test } from "bun:test";

import { initials } from "./avatar";

test("initials take the first and last word, leaving out titles and suffixes", () => {
  expect(["Nurul Huda", "Dr Test Aisyah", "Christopher Alexander Montgomery III", "Jo", "Martin Luther King Jr.", "🦊 Fox", "Ólafur Ólafsson"].map(initials)).toEqual(["NH", "TA", "CM", "J", "MK", "🦊F", "ÓÓ"]);
});
