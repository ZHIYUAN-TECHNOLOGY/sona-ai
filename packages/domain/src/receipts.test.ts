import { expect, test } from "bun:test";
import { issueOnce, memoryReceipts } from "./receipts";

test("replaying a requestId returns the first receipt without making another", async () => {
  const store = memoryReceipts<{ n: number }>();
  let made = 0;
  const make = () => ({ n: ++made });
  const first = await issueOnce(store, "req-1", make);
  const replay = await issueOnce(store, "req-1", make);
  expect(replay).toEqual({ n: 1 });
  expect(first).toEqual(replay);
  expect(made).toBe(1);
});

test("a different requestId issues its own receipt", async () => {
  const store = memoryReceipts<{ n: number }>();
  let made = 0;
  const make = () => ({ n: ++made });
  await issueOnce(store, "req-1", make);
  expect(await issueOnce(store, "req-2", make)).toEqual({ n: 2 });
});

test("a make that fails stores nothing, so the request can be retried", async () => {
  const store = memoryReceipts<string>();
  await expect(issueOnce(store, "req-1", () => { throw new Error("insurer down"); })).rejects.toThrow("insurer down");
  expect(await issueOnce(store, "req-1", async () => "ok")).toBe("ok");
});
