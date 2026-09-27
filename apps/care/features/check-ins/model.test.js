import { expect, test } from "bun:test";
import { readReply } from "@sona-ai/domain/check-ins";
import { answersFor, doneLine, historyLine, replyText, statusOf, todayOf } from "./model";

const checkIn = (day, dueAt, extra = {}) => ({ id: `check-in:visit-1042:${day}`, day, language: "ms", message: "Hai Amelia", dueAt: new Date(dueAt), sentAt: null, replies: [], ...extra });
const day2 = checkIn(2, "2026-09-28T02:00:00Z"), day7 = checkIn(7, "2026-10-03T02:00:00Z");
const reply = label => ({ id: "r", text: "demam balik", label, source: "fixture", receivedAt: new Date(), task: null });

test("a check-in waits for the patient once it is due or sent, until they answer; otherwise the next one is shown calmly", () => {
  expect(todayOf([day2, day7], new Date("2026-09-27T12:00:00Z"))).toEqual({ next: day2 });
  expect(todayOf([day2, day7], new Date("2026-09-28T03:00:00Z"))).toEqual({ ask: day2 });
  // Sent early (the demo jumps days): it waits even before its due time.
  const sent = { ...day2, sentAt: new Date("2026-09-27T01:00:00Z") };
  expect(todayOf([sent, day7], new Date("2026-09-27T02:00:00Z"))).toEqual({ ask: sent });
  const answered = { ...day2, replies: [reply("fine")] };
  expect(todayOf([answered, day7], new Date("2026-09-29T00:00:00Z"))).toEqual({ next: day7 });
  expect(todayOf([answered, { ...day7, replies: [reply("fine")] }], new Date("2026-10-04T00:00:00Z"))).toEqual({});
  expect(todayOf([], new Date())).toEqual({});
});

test("the question and quick answers are in the check-in's language, with a small English line when it is not English", () => {
  expect(answersFor("ms")).toMatchObject({ question: "Macam mana hari ini?", english: "How are you today?", answers: [["Lebih baik", "better"], ["Sama", "same"], ["Lebih teruk", "worse"]] });
  expect(answersFor("en")).toMatchObject({ question: "How are you feeling today?", english: undefined, answers: [["Better", "better"], ["About the same", "same"], ["Worse", "worse"]] });
  expect(answersFor("zh").answers.map(([, label]) => label)).toEqual(["better", "same", "worse"]);
});

test("after answering, worse or urgent says who was told and when they will call; fine only thanks them", () => {
  expect(doneLine("fine")).toEqual({ title: "Thank you", text: "Your care team will see this today.", tone: "muted" });
  expect(doneLine("worse", "Dizzy")).toEqual({ title: "Your care team has been told", text: "They will call you today about: dizzy.", tone: "amber" });
  expect(doneLine("worse").text).toBe("They will call you today.");
  expect(doneLine("urgent")).toEqual(doneLine("worse"));
});

test("the reply carries the answer and the quick reply together; 'that's all' sends the answer alone", () => {
  expect(replyText("Worse", "Dizzy")).toBe("Worse · Dizzy");
  expect(replyText("Better")).toBe("Better");
  expect(replyText("Better", "  ")).toBe("Better");
  expect(replyText("About the same", " I walked to the Mall ")).toBe("About the same · I walked to the Mall");
});

test("every Worse quick reply, in every language, reaches the care team as worse or urgent; chest pain as urgent", () => {
  for (const language of ["en", "ms", "zh"]) {
    const copy = answersFor(language), [worse] = copy.answers.filter(([, f]) => f === "worse").map(([t]) => t);
    for (const quick of copy.follow.worse.quick) expect(["worse", "urgent"]).toContain(readReply(replyText(worse, quick)));
    expect(readReply(replyText(worse, copy.follow.worse.quick[0]))).toBe("urgent");
    const [better] = copy.answers[0];
    expect(readReply(replyText(better, copy.follow.better.quick[0]))).toBe("fine");
    expect(copy.follow.better.none && copy.follow.same.none && !copy.follow.worse.none).toBeTruthy();
  }
});

test("the history's insight line counts answers and says what comes next", () => {
  expect(historyLine([], new Date())).toBe("None yet. We'll ask on day 2 and day 7 after you go home.");
  expect(historyLine([day2, day7], new Date("2026-09-27T12:00:00Z"))).toBe("0 of 2 answered · next Mon 28 Sep");
  expect(historyLine([day2, day7], new Date("2026-09-28T03:00:00Z"))).toBe("0 of 2 answered · one waiting for you");
  expect(historyLine([{ ...day2, replies: [reply("fine")] }, { ...day7, replies: [reply("fine")] }], new Date())).toBe("2 of 2 answered");
});

test("each past check-in says how the answer was read and what happened, in plain words", () => {
  const now = new Date("2026-09-29T00:00:00Z");
  expect(statusOf(checkIn(7, "2026-10-03T02:00:00Z"), now)).toEqual({ line: "Coming Sat 3 Oct", tone: "muted" });
  expect(statusOf(day2, now)).toEqual({ line: "Waiting for your answer", tone: "blue" });
  expect(statusOf({ ...day2, replies: [reply("fine")] }, now)).toEqual({ line: "All fine · your care team can see it", tone: "muted" });
  expect(statusOf({ ...day2, replies: [reply("worse")] }, now)).toEqual({ line: "Your care team was told", tone: "amber" });
  expect(statusOf({ ...day2, replies: [{ ...reply("urgent"), task: { id: "t", title: "x", completed: true } }] }, now)).toEqual({ line: "Your care team followed up", tone: "green" });
});
