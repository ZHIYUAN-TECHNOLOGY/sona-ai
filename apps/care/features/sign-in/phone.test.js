import { expect, test } from "bun:test";
import { codeDigits, toE164 } from "./phone";

test("a Malaysian mobile number becomes +60 and digits, however it is typed", () => {
  expect(toE164("012-345 6789")).toBe("+60123456789");
  expect(toE164("12 345 6789")).toBe("+60123456789");
  expect(toE164("+60 11-2345 6789")).toBe("+601123456789");
  expect(toE164("60123456789")).toBe("+60123456789");
});

test("too short or too long is not a number yet", () => {
  expect(toE164("0123")).toBeUndefined();
  expect(toE164("0123456789012")).toBeUndefined();
  expect(toE164("")).toBeUndefined();
});

test("a code keeps digits only, at most six", () => {
  expect(codeDigits("12 34-56")).toBe("123456");
  expect(codeDigits("1234567")).toBe("123456");
});
