import { expect, test } from "bun:test";
import { clearPhrase, draftText, inked, opened, sampleAt, sendPhrase, step, wordsOf } from "./live-turns";

const run = (...events) => events.reduce(step, opened(1, 0));
const said = s => s.turns.map(t => (t.who === "you" ? `you: ${t.text}` : `sona: ${t.reply}`));
const draft = s => draftText(s.draft);

test("a send phrase counts said last, whatever the case or closing punctuation, in English, Malay or Chinese", () => {
  expect(sendPhrase("Brief me on her potassium, submit.")).toBe("Brief me on her potassium");
  expect(sendPhrase("SUBMIT!")).toBe("");
  expect(sendPhrase("Check her creatinine. Send it.")).toBe("Check her creatinine.");
  expect(sendPhrase("Semak ubat dia, hantar")).toBe("Semak ubat dia");
  expect(sendPhrase("总结一下，提交。")).toBe("总结一下");
  expect(sendPhrase("请发送？")).toBe("请");
  // Never mid-sentence, never bare "send", never inside a word.
  expect(sendPhrase("Submit the referral to cardiology.")).toBeUndefined();
  expect(sendPhrase("Please send.")).toBeUndefined();
  expect(sendPhrase("We'll resubmit")).toBeUndefined();
  expect(sendPhrase("Dia sedang menghantar")).toBeUndefined();
});

test("a clear phrase counts only said on its own, so a finding never discards the draft", () => {
  expect(["Clear.", "cancel that", "Padam!", "取消。"].map(clearPhrase)).toEqual([true, true, true, true]);
  expect(clearPhrase("The lungs are clear.")).toBe(false);
});

test("chunks join with a space; a closing full stop goes when the next carries the sentence on", () => {
  expect(draftText([{ id: 1, text: "Brief me on her potassium." }, { id: 2, text: "and her creatinine." }])).toBe("Brief me on her potassium and her creatinine.");
  expect(draftText([{ id: 1, text: "Brief me." }, { id: 2, text: "What changed overnight?" }])).toBe("Brief me. What changed overnight?");
  expect(draftText([])).toBe("");
});

test("pauses never send: chunks build one draft in the order said, each partial replaced by its final reading", () => {
  let s = run({ type: "words", id: 1, text: "Brief me on" }, { type: "words", id: 2, text: "and her" }, { type: "heard", id: 1, text: "Brief me on her potassium." });
  expect([s.phase, draft(s), s.turns.length]).toEqual(["listening", "Brief me on her potassium and her", 0]);
  s = step(s, { type: "heard", id: 2, text: "and her creatinine." });
  expect(draft(s)).toBe("Brief me on her potassium and her creatinine.");
  // Nothing heard drops the chunk silently, partial and all.
  expect(step(s, { type: "heard", id: 3, text: "  " }).draft).toEqual(s.draft);
  expect(draft(run({ type: "words", id: 1, text: "uh" }, { type: "heard", id: 1, text: "" }))).toBe("");
});

test("the mic off keeps the draft; its last chunk is finished into it, and words after turning it back on join it", () => {
  const off = run({ type: "heard", id: 1, text: "Brief me." }, { type: "mic" });
  expect([off.phase, off.mic, draft(off)]).toEqual(["paused", false, "Brief me."]);
  const finished = step(step(off, { type: "words", id: 2, text: "ignored" }), { type: "heard", id: 2, text: "What changed?" });
  expect(draft(finished)).toBe("Brief me. What changed?");
  const on = step(finished, { type: "mic" });
  expect([on.phase, draft(step(on, { type: "words", id: 3, text: "overnight" }))]).toEqual(["listening", "Brief me. What changed? overnight"]);
});

test("Send waits for the last chunk's reading, then the draft becomes the clinician's turn and Sona thinks", () => {
  const sending = run({ type: "heard", id: 1, text: "Brief me on her potassium." }, { type: "words", id: 2, text: "and her" }, { type: "send" });
  expect([sending.phase, draft(sending), said(sending)]).toEqual(["thinking", "Brief me on her potassium and her", []]);
  expect(step(sending, { type: "send" })).toBe(sending);
  const sent = [{ type: "heard", id: 2, text: "and her creatinine." }, { type: "words", id: 3, text: "late" }, { type: "settled" }].reduce(step, sending);
  expect([sent.phase, draft(sent), said(sent)]).toEqual(["thinking", "", ["you: Brief me on her potassium and her creatinine."]]);
  // Nothing to send after all: the draft stays open.
  const empty = run({ type: "send" }, { type: "settled" });
  expect([empty.phase, empty.turns.length]).toEqual(["listening", 0]);
});

test("a send phrase said last sends the draft without it; what was said after it stays out", () => {
  const s = run({ type: "heard", id: 1, text: "Brief me on her potassium." }, { type: "words", id: 3, text: "um" }, { type: "heard", id: 2, text: "and her creatinine, submit." });
  expect([s.phase, draft(s)]).toEqual(["thinking", "Brief me on her potassium and her creatinine"]);
  const sent = [{ type: "heard", id: 3, text: "Um, actually" }, { type: "settled" }].reduce(step, s);
  expect(said(sent)).toEqual(["you: Brief me on her potassium and her creatinine"]);
});

test("a clear phrase or Clear discards the draft, and chunks still being read with it", () => {
  const spoken = run({ type: "heard", id: 1, text: "Brief me." }, { type: "words", id: 3, text: "next" }, { type: "heard", id: 2, text: "Cancel that." });
  expect(draft(spoken)).toBe("next");
  const cleared = step(run({ type: "heard", id: 1, text: "Brief me." }, { type: "words", id: 2, text: "on her" }), { type: "clear", upTo: 2 });
  expect(draft(cleared)).toBe("");
  expect(draft(step(cleared, { type: "heard", id: 2, text: "on her potassium" }))).toBe("");
  expect(draft(step(cleared, { type: "words", id: 3, text: "What changed" }))).toBe("What changed");
});

test("a reply resumes listening only with the mic on; one from an earlier opening, or chunks from before it, are dropped", () => {
  const asked = run({ type: "heard", id: 1, text: "Brief me" }, { type: "send" }, { type: "settled" });
  const on = step(asked, { type: "reply", reply: "lead", session: 1 });
  expect([on.phase, on.mic, said(on)]).toEqual(["listening", true, ["you: Brief me", "sona: lead"]]);
  const off = [{ type: "mic" }, { type: "reply", reply: "lead", session: 1 }].reduce(step, asked);
  expect([off.phase, off.mic]).toEqual(["paused", false]);
  expect(new Set(off.turns.map(t => t.id)).size).toBe(2);
  const reopened = run({ type: "heard", id: 1, text: "Brief me" }, { type: "send" }, { type: "settled" }, { type: "reply", reply: "late", session: 0 });
  expect(said(reopened)).toEqual(["you: Brief me"]);
  expect(draft(step(opened(2, 5), { type: "heard", id: 5, text: "from the last opening" }))).toBe("");
});

test("a failure turns the mic off with a notice and keeps the draft; a send waiting on the chunk is called off", () => {
  const failed = run({ type: "words", id: 1, text: "Who am" }, { type: "fail", id: 1, reply: "speech model starting" });
  expect([failed.phase, failed.mic, draft(failed), said(failed)]).toEqual(["paused", false, "Who am", ["sona: speech model starting"]]);
  expect(step(failed, { type: "fail", reply: "again" })).toBe(failed);
  expect(said(step(failed, { type: "fail", id: 2 }))).toEqual(said(failed));
  const called = run({ type: "words", id: 1, text: "Who am" }, { type: "send" }, { type: "fail", id: 1, reply: "no" });
  expect([called.phase, called.sending, draft(called)]).toEqual(["paused", undefined, "Who am"]);
});

test("the keyboard takes over: the mic goes off and the last chunk still joins the draft", () => {
  const s = run({ type: "words", id: 1, text: "Brief" }, { type: "keyboard" });
  expect([s.phase, s.mic, s.handoff]).toEqual(["paused", false, true]);
  expect(draft(step(s, { type: "heard", id: 1, text: "Brief me." }))).toBe("Brief me.");
});

test("typing in Live: the composer takes the draft, and a typed question is a turn like a spoken one", () => {
  const handed = run({ type: "heard", id: 1, text: "Brief me" }, { type: "keyboard" }, { type: "handed" });
  expect([handed.phase, handed.mic, handed.handoff, draft(handed)]).toEqual(["paused", false, undefined, ""]);
  const typed = step(handed, { type: "say", text: " Brief me on Amelia " });
  expect([typed.phase, said(typed)]).toEqual(["thinking", ["you: Brief me on Amelia"]]);
  // Sona answers one question at a time, and an empty box sends nothing.
  expect(step(typed, { type: "say", text: "Next" })).toBe(typed);
  expect(step(handed, { type: "say", text: "  " })).toBe(handed);
  // The reply lands, and with the mic off Live waits, paused.
  expect(step(typed, { type: "reply", reply: "ok", session: 1 }).phase).toBe("paused");
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

test("the demo sample keeps the dock's timing: a word every 170 ms after 380 ms", () => {
  expect([sampleAt(0), sampleAt(1), sampleAt(5)]).toEqual([380, 550, 1230]);
});
