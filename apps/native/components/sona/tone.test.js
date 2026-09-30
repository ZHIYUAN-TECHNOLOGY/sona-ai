import { expect, test } from "bun:test";
import { mostUrgent } from "./tone";

test("a set of items takes the colour of its most urgent item", () => {
  expect(mostUrgent(["soon", "soon"])).toBe("soon");
  expect(mostUrgent(["soon", "urgent", "soon"])).toBe("urgent");
  expect(mostUrgent(["good", "caution"])).toBe("caution");
  expect(mostUrgent(["good", "next", "calm"])).toBe("next");
  expect(mostUrgent(["good", "calm"])).toBe("good");
});

test("nothing meaningful reads neutral", () => {
  expect(mostUrgent([])).toBe("calm");
  expect(mostUrgent([undefined, "calm", "routine"])).toBe("calm");
});
