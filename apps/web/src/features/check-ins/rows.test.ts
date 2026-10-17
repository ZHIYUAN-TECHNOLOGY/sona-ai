// @ts-expect-error apps/web has no bun types yet, as in results/tabs.test.ts
import { expect, test } from "bun:test";
import { byUrgency, shownReply, stateOf } from "./rows";

const at = new Date("2026-10-01T02:00:00Z");
const reply = (label: "fine" | "worse" | "urgent", open?: boolean) => ({ label, receivedAt: at, task: open === undefined ? null : { id: "t", title: "t", completed: !open } });

test("a check-in needs action only while a flagged reply's task is open", () => {
  expect(stateOf({ sentAt: at, dueAt: at, replies: [] })).toBe("waiting");
  expect(stateOf({ sentAt: at, dueAt: at, replies: [reply("fine")] })).toBe("done");
  expect(stateOf({ sentAt: at, dueAt: at, replies: [reply("worse", true), reply("fine")] })).toBe("action");
  expect(stateOf({ sentAt: at, dueAt: at, replies: [reply("urgent", false)] })).toBe("done");
  expect(shownReply([reply("worse", true), reply("fine")])?.label).toBe("worse");
});

test("red flags sort first, then worse, then newest", () => {
  const rows = [
    { id: "old", state: "done" as const, reply: reply("fine"), at: 1 },
    { id: "new", state: "waiting" as const, at: 9 },
    { id: "worse", state: "action" as const, reply: reply("worse", true), at: 2 },
    { id: "red", state: "action" as const, reply: reply("urgent", true), at: 1 },
  ];
  expect(rows.sort(byUrgency).map(r => r.id)).toEqual(["red", "worse", "new", "old"]);
});
