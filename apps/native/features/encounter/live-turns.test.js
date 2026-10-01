import { expect, test } from "bun:test";
import { inked, opened, sampleAt, sampleEnd, step, wordsOf } from "./live-turns";

const run = (...events) => events.reduce(step, opened());
const said = s => s.turns.map(t => (t.who === "you" ? `${t.final ? "you" : "you…"}: ${t.text}` : `sona: ${t.reply}`));

test("a turn streams in, ends, and Sona thinks with the microphone paused", () => {
  const s = run({ type: "words", text: "Who am" }, { type: "words", text: "Who am I seeing" });
  expect(s.phase).toBe("listening");
  expect(said(s)).toEqual(["you…: Who am I seeing"]);
  const reading = step(s, { type: "ending" });
  expect(reading.phase).toBe("thinking");
  expect(said(reading)).toEqual(["you…: Who am I seeing"]);
  const asked = step(reading, { type: "end", text: "Who am I seeing first?" });
  expect(asked.phase).toBe("thinking");
  expect(said(asked)).toEqual(["you: Who am I seeing first?"]);
  expect(step(asked, { type: "words", text: "late partial" })).toBe(asked);
});

test("a reply resumes listening when the mic is on, and stays paused when it was turned off meanwhile", () => {
  const asked = run({ type: "end", text: "Brief me" });
  const on = step(asked, { type: "reply", reply: "lead" });
  expect([on.phase, on.mic]).toEqual(["listening", true]);
  expect(said(on)).toEqual(["you: Brief me", "sona: lead"]);
  const off = run({ type: "end", text: "Brief me" }, { type: "mic" }, { type: "reply", reply: "lead" });
  expect([off.phase, off.mic]).toEqual(["paused", false]);
  expect(new Set(off.turns.map(t => t.id)).size).toBe(2);
});

test("the mic button pauses and resumes without ending the page; pausing drops the unfinished turn", () => {
  const before = run({ type: "end", text: "Brief me" }, { type: "reply", reply: "lead" }, { type: "words", text: "And her" });
  const paused = step(before, { type: "mic" });
  expect([paused.phase, paused.mic]).toEqual(["paused", false]);
  expect(said(paused)).toEqual(["you: Brief me", "sona: lead"]);
  expect(step(paused, { type: "words", text: "ignored" })).toBe(paused);
  expect(step(paused, { type: "end", text: "ignored" })).toBe(paused);
  const resumed = step(paused, { type: "mic" });
  expect([resumed.phase, resumed.mic]).toEqual(["listening", true]);
});

test("a failure pauses with a notice; one arriving after the mic was turned off is ignored; nothing heard drops the turn", () => {
  const failed = run({ type: "words", text: "Who" }, { type: "fail", reply: "speech model starting" });
  expect([failed.phase, failed.mic]).toEqual(["paused", false]);
  expect(said(failed)).toEqual(["sona: speech model starting"]);
  expect(step(failed, { type: "fail", reply: "again" })).toBe(failed);
  expect(said(run({ type: "words", text: "Who" }, { type: "drop" }))).toEqual([]);
  const empty = run({ type: "ending" }, { type: "end", text: "  " });
  expect([empty.phase, empty.turns.length]).toEqual(["listening", 0]);
});

test("the lead inks a word every 35 ms, all at once under Reduce Motion", () => {
  expect(wordsOf("  Amelia is  42. ")).toEqual(["Amelia", "is", "42."]);
  expect(inked(0, 5)).toBe(0);
  expect(inked(34, 5)).toBe(0);
  expect(inked(35, 5)).toBe(1);
  expect(inked(105, 5)).toBe(3);
  expect(inked(10_000, 5)).toBe(5);
  expect(inked(0, 5, true)).toBe(5);
});

test("the demo sample keeps the dock's timing: a word every 170 ms after 380 ms, sent on a 1.3 s pause", () => {
  expect([sampleAt(0), sampleAt(1), sampleAt(5)]).toEqual([380, 550, 1230]);
  expect(sampleEnd(6)).toBe(1230 + 1300);
});
