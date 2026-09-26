import { expect, test } from "bun:test";
import { unreadReply } from "./model";

const m = (id, from) => ({ id, from, text: id, createdAt: new Date() });

test("a reply waits for the patient only when the care team spoke last and it has not been read here", () => {
  expect(unreadReply([m("a", "patient"), m("b", "care-team")], undefined)).toBe(true);
  expect(unreadReply([m("a", "patient"), m("b", "care-team")], "b")).toBe(false);
  expect(unreadReply([m("b", "care-team"), m("c", "patient")], "a")).toBe(false);
  expect(unreadReply([], undefined)).toBe(false);
});
