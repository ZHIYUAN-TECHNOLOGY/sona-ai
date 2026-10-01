import { expect, test } from "bun:test";
import { needsYou } from "./answers";
import { EMPTY, answerOf, threadStep } from "./thread";

const needs = needsYou([]);
const run = (...steps) => steps.reduce(threadStep, EMPTY);
const said = t => t.entries.map(e => `${e.id} ${e.question}: ${!e.reply ? "thinking" : "notice" in e.reply ? e.reply.notice : e.reply.answer.id}`);
const ask = (question, reply, day = "Thu Oct 01 2026") => ({ type: "ask", question, day, reply });

test("a rule answer lands with its question; a free question thinks until its reply; newest last", () => {
  const t = run(ask("Who am I seeing first?", { answer: needs }), ask("Any sepsis on the ward?"));
  expect(said(t)).toEqual(["0 Who am I seeing first?: needs", "1 Any sepsis on the ward?: thinking"]);
  const answered = threadStep(t, { type: "reply", id: 1, reply: { answer: { ...needs, id: "free" }, model: "gemma" } });
  expect(said(answered)).toEqual(["0 Who am I seeing first?: needs", "1 Any sepsis on the ward?: free"]);
  expect(answerOf(answered.entries[1])?.id).toBe("free");
  expect(answered.entries[0]).toBe(t.entries[0]); // other entries are untouched
});

test("a notice worth asking again thinks again in place, then takes the answer", () => {
  const waking = run(ask("Any sepsis?"), { type: "reply", id: 0, reply: { notice: "Sona's model is starting", again: true } });
  expect(answerOf(waking.entries[0])).toBeUndefined();
  const again = threadStep(waking, { type: "reply", id: 0 });
  expect(said(again)).toEqual(["0 Any sepsis?: thinking"]);
  expect(said(threadStep(again, { type: "reply", id: 0, reply: { answer: needs } }))).toEqual(["0 Any sepsis?: needs"]);
});

test("New conversation clears; a reply that lands later is dropped and never fills a newer question", () => {
  const cleared = run(ask("Any sepsis?"), { type: "clear" });
  expect(cleared.entries).toEqual([]);
  const next = threadStep(cleared, ask("What's overdue?"));
  expect(said(threadStep(next, { type: "reply", id: 0, reply: { notice: "late" } }))).toEqual(["1 What's overdue?: thinking"]);
});

test("a new day starts a new conversation", () => {
  const t = run(ask("Who needs me?", { answer: needs }), ask("What's overdue?", undefined, "Fri Oct 02 2026"));
  expect(said(t)).toEqual(["1 What's overdue?: thinking"]);
  expect(t.day).toBe("Fri Oct 02 2026");
});
