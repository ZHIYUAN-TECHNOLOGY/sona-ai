// @ts-ignore -- apps/web has no Bun types installed; drop this line once @types/bun is a devDependency.
import { expect, test } from "bun:test";

import { afterReply, currentCheckIn, daysSince, firstSentence, langOf, leadOf, nextCheckIn, nextOf, toBase64 } from "./model";

test("discharge plan helpers: next step, first sentence, days since", () => {
  expect(nextOf({ tone: "soon", title: "", text: "", to: "/care/check-ins" })?.to).toBe("/care/check-ins");
  expect(nextOf({ tone: "soon", title: "", text: "" })?.to).toBe("/care/follow-ups");
  expect(nextOf({ tone: "info", title: "", text: "" })?.to).toBe("/care/medicines");
  expect(nextOf({ tone: "done", title: "", text: "" })).toBeUndefined();
  expect(firstSentence("You had a chest infection. Rest at home.")).toBe("You had a chest infection.");
  expect(firstSentence("No full stop")).toBe("No full stop");
  expect(daysSince("2026-10-01T10:00:00Z", new Date("2026-10-04T09:00:00Z"))).toBe(2);
  expect(daysSince("2026-10-05T10:00:00Z", new Date("2026-10-04T09:00:00Z"))).toBe(0);
});

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
