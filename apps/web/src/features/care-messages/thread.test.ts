// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { SENDING, addSending, rollBack, settle, stateOf } from "./thread";

const at = new Date(0);
const mine = (id: string, seenAt: Date | null = null) => ({ id, from: "patient", text: id, createdAt: at, seenAt });

test("a message is sending, sent, seen, then replied", () => {
  expect(stateOf([mine(`${SENDING}r1`)], 0)).toBe("sending");
  expect(stateOf([mine("a")], 0)).toBe("sent");
  expect(stateOf([mine("a", at)], 0)).toBe("seen");
  expect(stateOf([mine("a", at), { ...mine("b"), from: "care-team" }], 0)).toBe("replied");
});

test("a sent message appears at once, settles once, and rolls back on error", () => {
  const sending = addSending([mine("a")], mine(`${SENDING}r1`));
  expect(sending.map(m => m.id)).toEqual(["a", `${SENDING}r1`]);
  expect(settle([...sending, mine("stored")], "r1", mine("stored")).map(m => m.id)).toEqual(["a", "stored"]);
  expect(rollBack(sending, "r1").map(m => m.id)).toEqual(["a"]);
});
