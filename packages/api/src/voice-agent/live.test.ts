import { expect, test } from "bun:test";

import { Checks, LiveTurns, liveBrief, mayReport } from "./live";

const listen = { listen: true, text: "", end_of_turn: false };
const speak = (text: string, end_of_turn = false) => ({ listen: false, text, end_of_turn });

test("box ④'s seconds become one answer on the phone: opened on the first spoken second, closed at her end of turn", () => {
  const turns = new LiveTurns();
  expect(turns.unit(listen)).toEqual([]);
  expect(turns.unit(speak(" Take it after"))).toEqual([
    { type: "transcript_start", role: "assistant" }, { type: "status", status: "speaking" }, { type: "transcript_delta", text: " Take it after" },
  ]);
  expect(turns.unit(speak(" food."))).toEqual([{ type: "transcript_delta", text: " food." }]);
  expect(turns.unit(speak("", true))).toEqual([{ type: "transcript_end", text: "Take it after food." }, { type: "status", status: "listening" }]);
  expect(turns.unit(listen)).toEqual([]);
  expect(turns.unit(speak(" Ya."))[0]).toEqual({ type: "transcript_start", role: "assistant" });
  expect(turns.said).toEqual(["Take it after food."]);
});

test("the 999 floor sees 999 in an answer since the emergency was heard, finished or still being spoken", () => {
  const turns = new LiveTurns();
  turns.unit(speak(" Take it after food.", true));
  const from = turns.said.length;
  expect(turns.sent999(from)).toBe(false);
  turns.unit(speak(" Call 999"));
  expect(turns.sent999(from)).toBe(true);
  expect(turns.sent999(turns.said.length)).toBe(true);
  turns.unit(speak(" now.", true));
  expect(turns.sent999(from)).toBe(true);
  expect(turns.sent999(turns.said.length)).toBe(false);
});

test("the brief is the one stage 1 learnt, in the patient's language, with their plan or none yet", () => {
  expect(liveBrief("Medicines:\n- Amoxicillin 500mg", "ms")).toEndWith("answer in Malay.\n\nDischarge plan:\nMedicines:\n- Amoxicillin 500mg");
  expect(liveBrief(undefined, "en")).toEndWith("Discharge plan:\nNone yet: they are still in hospital.");
  expect(liveBrief(undefined, "en")).not.toContain("JSON");
});

test("only words that may report feeling worse go on to the care team's reader", () => {
  expect(mayReport("Demam saya datang balik")).toBe(true);
  expect(mayReport("When is my next appointment?")).toBe(false);
});

test("a check fires once a turn, whichever ear hears it first and however late the other comes", () => {
  const checks = new Checks();
  expect(checks.take("report", "box4", "Doktor saya patuk sampai tidur tak boleh, still demam.", 1000)).toBe(true);
  // Box ② wakes 40 s later with the same turn, spelt its own way: no second task.
  expect(checks.take("report", "box2", "Doktor, saya batuk sampai tak boleh tidur. Still demam.", 41_000)).toBe(false);
  // A different symptom straight after fires, from either ear, once.
  expect(checks.take("report", "box4", "My chest pain is getting worse.", 43_000)).toBe(true);
  expect(checks.take("report", "box2", "My chest pain is getting worse", 44_000)).toBe(false);
  // The other check keeps its own turns, and the same words said again later are a new turn.
  expect(checks.take("call999", "box2", "My chest pain is getting worse", 44_000)).toBe(true);
  expect(checks.take("report", "box4", "My chest pain is getting worse.", 90_000)).toBe(true);
});

test("999 said in words counts as sending them to 999", () => {
  const turns = new LiveTurns();
  turns.unit(speak(" Call nine nine nine now.", true));
  expect(turns.sent999(0)).toBe(true);
});
