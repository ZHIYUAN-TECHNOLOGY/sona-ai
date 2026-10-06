// @ts-ignore -- apps/web has no Bun types installed; drop this line once @types/bun is a devDependency.
import { expect, test } from "bun:test";

import { afterReply, currentCheckIn, langOf, leadOf, nextCheckIn, toBase64 } from "./model";

test("language falls back to English", () => {
  expect(langOf("ms-MY")).toBe("ms");
  expect(langOf("zh-CN")).toBe("zh");
  expect(langOf("fr-FR")).toBe("en");
  expect(langOf(undefined)).toBe("en");
});

test("the current check-in is the newest sent one without a reply", () => {
  const list = [
    { id: "a", sentAt: "2026-10-01", dueAt: "2026-10-01", replies: [{}] },
    { id: "b", sentAt: "2026-10-05", dueAt: "2026-10-05", replies: [] },
    { id: "c", sentAt: null, dueAt: "2026-10-09", replies: [] },
  ];
  expect(currentCheckIn(list)?.id).toBe("b");
  expect(nextCheckIn(list)?.id).toBe("c");
  expect(currentCheckIn(list.slice(0, 1))).toBeUndefined();
});

test("the lead puts a waiting check-in first, then a near visit, then a medicine", () => {
  const visits = [{ title: "Clinic review", date: "2026-10-07", inDays: 1, status: "due-soon" }];
  const meds = [{ name: "Amoxicillin", take: "One capsule three times a day" }];
  expect(leadOf({ checkInWaiting: true, visits, meds }).to).toBe("/care/check-ins");
  expect(leadOf({ checkInWaiting: false, visits, meds }).title).toContain("tomorrow");
  expect(leadOf({ checkInWaiting: false, visits: [], meds }).title).toBe("Take your Amoxicillin");
  expect(leadOf({ checkInWaiting: false, visits: [], meds: [] }).tone).toBe("done");
});

test("only an urgent reply is red", () => {
  expect(afterReply("urgent", null).tone).toBe("urgent");
  expect(afterReply("worse", { title: "Nurse call" }).text).toContain("Nurse call");
  expect(afterReply("fine", null).tone).toBe("done");
});

test("base64 of bytes", () => {
  expect(toBase64(new Uint8Array([82, 73, 70, 70]))).toBe("UklGRg==");
});
