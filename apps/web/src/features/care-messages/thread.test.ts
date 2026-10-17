// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { SENDING, addSending, dayOf, rollBack, settle, stateOf, clockOf, leadOf, statusOf } from "./thread";

test("dayOf names today and yesterday, and dates anything older", () => {
  const now = new Date(2026, 9, 6, 0, 30);
  expect(dayOf(new Date(2026, 9, 6, 0, 5), now)).toBe("Today");
  expect(dayOf(new Date(2026, 9, 5, 23, 55), now)).toBe("Yesterday");
  expect(dayOf(new Date(2026, 9, 1, 12), now)).not.toMatch(/Today|Yesterday/);
});

const at = new Date(0);
const mine = (id: string, seenAt: Date | null = null) => ({ id, from: "patient", text: id, createdAt: at, seenAt });

test("a message is sending, sent, seen, then replied", () => {
  expect(stateOf([mine(`${SENDING}r1`)], 0)).toBe("sending");
  expect(stateOf([mine("a")], 0)).toBe("sent");
  expect(stateOf([mine("a", at)], 0)).toBe("seen");
  expect(stateOf([mine("a", at), { ...mine("b"), from: "care-team" }], 0)).toBe("replied");
});

test("the lead and the status line come from the newest message", () => {
  const now = new Date(2026, 9, 6, 21, 0), wrote = new Date(2026, 9, 6, 20, 2);
  const m = { ...mine("a"), createdAt: wrote };
  expect(leadOf([], now)).toBe("No messages yet. Write your first one below.");
  expect(leadOf([m], now)).toBe(`You wrote at ${clockOf(wrote)}. Waiting for a reply.`);
  expect(leadOf([m, { ...m, id: "b", from: "care-team" }], now)).toBe(`Your care team replied at ${clockOf(wrote)}.`);
  expect(leadOf([m, { ...m, id: "b", from: "sona", rule: "call-999" }], now)).toMatch(/^Sona sent an automatic safety reply/);
  expect(statusOf([m])).toBe("Sent. Your care team will see it.");
  expect(statusOf([{ ...m, seenAt: wrote }])).toBe("Seen by your care team");
  expect(statusOf([m, { ...m, id: "b", from: "care-team" }])).toBeNull();
});

test("a sent message appears at once, settles once, and rolls back on error", () => {
  const sending = addSending([mine("a")], mine(`${SENDING}r1`));
  expect(sending.map(m => m.id)).toEqual(["a", `${SENDING}r1`]);
  expect(settle([...sending, mine("stored")], "r1", mine("stored")).map(m => m.id)).toEqual(["a", "stored"]);
  expect(rollBack(sending, "r1").map(m => m.id)).toEqual(["a"]);
});
