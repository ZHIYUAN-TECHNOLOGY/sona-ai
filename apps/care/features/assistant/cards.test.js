import { expect, test } from "bun:test";
import { cardsOf, MARK_KINDS } from "@sona-ai/domain/answer-parts";
import { SAMPLE_ANSWERS } from "./answer-fixtures";
import { cardLabel, careCards } from "./cards";
import { chosenIn } from "./terms";

test("the preview's answers show every mark kind, every card and every action Sona Care has, each one as the contract reads it", () => {
  const cards = SAMPLE_ANSWERS.flatMap(s => s.cards);
  expect(new Set(SAMPLE_ANSWERS.flatMap(s => s.marks.map(m => m.kind)))).toEqual(new Set(MARK_KINDS));
  expect(new Set(cards.map(c => c.type))).toEqual(new Set(["medicine", "result", "reading", "appointment", "warning", "steps", "doctor", "action"]));
  expect(new Set(cards.flatMap(c => c.type === "action" ? [c.do] : []))).toEqual(new Set(["book", "logDose", "logReading", "tellCareTeam"]));
  expect(new Set(cards.flatMap(c => c.type === "warning" ? [c.level] : []))).toEqual(new Set(["urgent", "soon", "info"]));
  for (const s of SAMPLE_ANSWERS) {
    // Nothing is dropped on the way in (a field missing, a second action), and every mark is in the words, so it is coloured.
    expect(cardsOf(s.cards)).toEqual(s.cards);
    expect(chosenIn(s.answer, s.marks).length).toBe(s.marks.length);
  }
});

test("each card reads as one sentence, its flag or status a word in her language", () => {
  const [medicine] = SAMPLE_ANSWERS[0].cards, [result, reading] = SAMPLE_ANSWERS[1].cards, [visit, requested] = SAMPLE_ANSWERS[2].cards;
  expect(cardLabel(medicine, "en")).toBe("Azithromycin, 1 tablet, at 8:00 AM, With or without food, 2 more days, Your discharge plan");
  expect(cardLabel(result, "en")).toBe("Potassium 3.1 mmol/L, Low, Usual range 3.5 to 5.1 mmol/L, Fri 9 Oct 9:30 AM, Lab result");
  expect(cardLabel(reading, "ms")).toBe("Blood pressure 128/82 mmHg, Normal, Ahd 11 Okt, 8:15 PG");
  expect(cardLabel(visit, "en")).toBe("Clinic review, Sat 24 Oct 10:00 AM, Clinic 3B, Level 3, Upcoming");
  expect(cardLabel(requested, "zh")).toContain("已申请");
  expect(cardLabel(SAMPLE_ANSWERS[4].cards[0], "en")).toBe("Call 999 if you have, Blue lips or face, Trouble breathing, Chest pain");
});

test("a task drafted for a clinician is Sona Pro's: Sona Care never shows it", () => {
  const task = { type: "action", do: "createTask", title: "Recheck potassium", confirm: "Create task", done: "Task created", payload: { encounterId: "e1", title: "Recheck K", owner: "ward" } };
  const [medicine] = SAMPLE_ANSWERS[0].cards;
  expect(careCards([medicine, task])).toEqual([medicine]);
  expect(careCards(undefined)).toEqual([]);
});
