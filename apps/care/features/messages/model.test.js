import { expect, test } from "bun:test";
import { rowLine, suggestions, unreadReply, whileYouWait, withDays } from "./model";

const m = (id, from, text = id, createdAt = new Date()) => ({ id, from, text, createdAt });

test("a reply waits for the patient only when the care team spoke last and it has not been read here", () => {
  expect(unreadReply([m("a", "patient"), m("b", "care-team")], undefined)).toBe(true);
  expect(unreadReply([m("a", "patient"), m("b", "care-team")], "b")).toBe(false);
  expect(unreadReply([m("b", "care-team"), m("c", "patient")], "a")).toBe(false);
  expect(unreadReply([], undefined)).toBe(false);
});

test("home's row names a waiting reply, then a sent message, else the emergency line", () => {
  expect(rowLine([m("a", "care-team", "Keep taking it")], undefined)).toEqual({ line: "New reply · Keep taking it", tone: "green" });
  expect(rowLine([m("a", "care-team", "Keep taking it")], "a").line).toBe("Not for emergencies · call 999");
  expect(rowLine([m("a", "patient")], undefined).line).toBe("Sent · usually replies within a few hours");
  expect(rowLine(undefined, undefined).line).toBe("Not for emergencies · call 999");
});

test("a day pill opens each Malaysian day, named Today and Yesterday when close", () => {
  const now = new Date("2026-09-27T04:00:00Z"); // Sun 12:00 in Malaysia
  const items = withDays([
    m("a", "care-team", "a", new Date("2026-09-25T02:00:00Z")),
    m("b", "patient", "b", new Date("2026-09-26T15:30:00Z")), // 23:30 Sat in Malaysia
    m("c", "care-team", "c", new Date("2026-09-26T16:30:00Z")), // 00:30 Sun in Malaysia
    m("d", "patient", "d", new Date("2026-09-27T03:00:00Z")),
  ], now);
  expect(items.map(i => i.day ?? i.message.id)).toEqual(["Fri 25 Sep", "a", "Yesterday", "b", "Today", "c", "d"]);
  expect(withDays([], now)).toEqual([]);
});

test("the while-you-wait card shows for an unanswered warning sign, most serious first", () => {
  expect(whileYouWait([m("a", "patient", "I feel a bit dizzy")])).toBe("Sit or lie down, stand up slowly and drink some water.");
  expect(whileYouWait([m("a", "patient", "Dizzy and some chest pain")])).toContain("sit upright");
  expect(whileYouWait([m("a", "patient", "I'm short of breath")])).toContain("breathe slowly");
  expect(whileYouWait([m("a", "patient", "I fainted this morning")])).toContain("legs raised");
  expect(whileYouWait([m("a", "patient", "The wound is bleeding")])).toContain("clean cloth");
  expect(whileYouWait([m("a", "patient", "My blood pressure was 130 today")])).toBeUndefined();
  expect(whileYouWait([m("a", "patient", "Going well, thank you")])).toBeUndefined();
  expect(whileYouWait([m("a", "patient", "I feel dizzy"), m("b", "care-team", "Sit down and rest")])).toBeUndefined();
  expect(whileYouWait([])).toBeUndefined();
});

test("suggestions follow where the thread stands and never repeat what was just sent", () => {
  expect(suggestions([])).toEqual(["I have a question about my medicine", "When is my next visit?", "I feel a bit dizzy"]);
  expect(suggestions([m("a", "care-team", "How is the new medicine going?")])).toEqual(["Going well, thank you", "I have a question about my medicine", "I feel a bit dizzy"]);
  expect(suggestions([m("a", "care-team", "Keep taking it.")])).toEqual(["Thank you", "I have a question about my medicine", "When is my next visit?"]);
  expect(suggestions([m("a", "patient", "I feel a bit dizzy")])).toEqual(["Thank you", "When is my next visit?"]);
  expect(suggestions([m("a", "patient", "When is my next visit?")])).toEqual(["Thank you"]);
  expect(suggestions([m("a", "patient", "thank you"), m("b", "care-team", "See you soon.")])).toEqual(["I have a question about my medicine", "When is my next visit?"]);
});
