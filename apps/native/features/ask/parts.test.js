import { expect, test } from "bun:test";
import { partsOf } from "@sona-ai/domain/answer-parts";
import { segments } from "@/components/sona/marked-terms";
import { cardBlocks, rowOf, taskOfOp, taskOp, when } from "./parts";
import { RICH_ANSWERS } from "./rich-fixture";

const [rich, more] = RICH_ANSWERS;

test("the fixture answers carry a mark of every kind and a card of every kind, all read by the contract", () => {
  const read = RICH_ANSWERS.map(partsOf);
  expect(new Set(read.flatMap(p => p.marks.map(m => m.kind)))).toEqual(new Set(["warning", "caution", "medicine", "dose", "condition", "symptom", "test"]));
  expect(new Set(read.flatMap(p => p.cards.map(c => c.type)))).toEqual(new Set(["medicine", "result", "reading", "appointment", "warning", "steps", "doctor", "action"]));
  expect(read.map(p => p.cards.length)).toEqual([6, 6]);
  // Every mark names words in its lead, so each one colours.
  for (const a of RICH_ANSWERS) expect(segments(a.lead, partsOf(a).marks).filter(s => s.mark)).toHaveLength(a.marks.length);
});

test("Pro shows consecutive facts as one list, then each warning, steps or drafted task; the doctor is Sona Care's", () => {
  expect(cardBlocks(partsOf(rich).cards).map(b => "rows" in b ? b.rows.map(r => r.type) : b.type)).toEqual([["result", "reading", "medicine"], "warning", "steps", "action"]);
  expect(cardBlocks(partsOf(more).cards).map(b => "rows" in b ? b.rows.map(r => r.type) : b.type)).toEqual([["result", "appointment", "appointment"], "warning", "warning"]);
  // A patient's own action (book, log a dose) is never drawn in Pro.
  expect(cardBlocks([{ type: "action", do: "logDose", title: "Log it", confirm: "Log", done: "Logged", payload: { key: "a:b" } }])).toEqual([]);
});

test("a fact reads as a row with its flag or status as a word in its tone, and as one sentence to VoiceOver", () => {
  const [potassium, heart, furosemide] = partsOf(rich).cards;
  expect(rowOf(potassium)).toEqual({ title: "Potassium", trailing: "3.1 mmol/L", tone: "soon", detail: `Low · usual 3.5 to 5.1 mmol/L · ${when(potassium.at)} · Lab result`,
    label: `Potassium 3.1 mmol/L, low, usual range 3.5 to 5.1 mmol/L, ${when(potassium.at)}, Lab result` });
  expect(rowOf(heart)).toMatchObject({ trailing: "112 /min", tone: "soon", detail: `High · ${when(heart.at)}` });
  expect(rowOf(furosemide)).toMatchObject({ title: "Furosemide", tone: "calm", detail: "40 mg · 08:00, 20:00 · By mouth · Review if potassium stays low · Prescription" });
  const [sodium, renal, diabetes] = partsOf(more).cards;
  expect(rowOf(sodium)).toMatchObject({ tone: "urgent", detail: expect.stringMatching(/^Critical · /) });
  expect(rowOf(renal)).toMatchObject({ tone: "soon", detail: `Requested · ${when(renal.when)} · Clinic 3, Level 2` });
  expect(rowOf(diabetes)).toMatchObject({ tone: "good", label: `Diabetes clinic, confirmed, ${when(diabetes.when)}` });
  expect(when("2026-10-11T00:30:00.000Z")).toBe("Sun 11 Oct, 08:30");
});

test("a drafted task's op carries its tasks.create input whole, any language, and nothing else reads as one", () => {
  const payload = { encounterId: "ENC-1", title: "Semak semula U&E esok · 复查电解质", owner: "Jururawat malam", due: "2026-10-12" };
  const op = taskOp(payload);
  expect(op.startsWith("task-new:")).toBe(true);
  expect(taskOfOp(op.slice("task-new:".length))).toEqual(payload);
  expect(taskOfOp(taskOp({ encounterId: "ENC-1", title: " Call family ", owner: "MO" }).slice(9))).toEqual({ encounterId: "ENC-1", title: "Call family", owner: "MO" });
  for (const bad of ["", "%7B", encodeURIComponent(JSON.stringify({ encounterId: "ENC-1", title: "", owner: "MO" })), encodeURIComponent(JSON.stringify({ encounterId: "ENC-1", title: "x", owner: "MO", due: "tomorrow" }))]) expect(taskOfOp(bad)).toBeUndefined();
});
