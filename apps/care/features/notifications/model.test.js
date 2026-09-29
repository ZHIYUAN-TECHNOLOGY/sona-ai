import { expect, test } from "bun:test";
import { asksForNudges, routeOf } from "./model";

test("a push opens only its own screen", () => {
  expect(routeOf("sona-care:///follow-ups")).toBe("/follow-ups");
  expect(routeOf("sona-care:///check-ins")).toBe("/check-ins");
  expect(routeOf("sona-care:///messages?x=1")).toBe("/messages");
  expect(routeOf("https://evil.test/messages")).toBeUndefined();
  expect(routeOf("sona-care:///join")).toBeUndefined();
  expect(routeOf(undefined)).toBeUndefined();
});

test("a dose reminder opens the Medicine screen at its own dose", () => {
  expect(routeOf("sona-care:///dose?key=Cetirizine%402026-09-27T13%3A00%3A00.000Z")).toBe("/dose?key=Cetirizine%402026-09-27T13%3A00%3A00.000Z");
  expect(routeOf("sona-care:///dose")).toBe("/dose");
  expect(routeOf("https://evil.test/dose?key=x")).toBeUndefined();
});

test("the home card asks once, and not when notifications are already allowed", () => {
  expect(asksForNudges(undefined, "undetermined")).toBe(true);
  expect(asksForNudges(undefined, "denied")).toBe(true);
  expect(asksForNudges(undefined, "granted")).toBe(false);
  expect(asksForNudges(undefined, undefined)).toBe(false);
  expect(asksForNudges("later", "undetermined")).toBe(false);
  expect(asksForNudges("on", "denied")).toBe(false);
});
