import { expect, test } from "bun:test";
import { MARK_HUE, MARK_KINDS, cardsOf, markKindOf, marksOf, partsOf, toneOf, type AnswerCard } from "./answer-parts";

test("old marks still render: Pro's alert and finding and Care's when read as warning, condition and dose", () => {
  expect(["alert", "finding", "when", "dose", "medicine", "symptom", "caution", "warning"].map(markKindOf)).toEqual(["warning", "condition", "dose", "dose", "medicine", "symptom", "caution", "warning"]);
  expect(markKindOf("sparkle")).toBeUndefined();
  // A care.ask answer from before 11 Oct, and an ask.free one: each word keeps its colour, an unknown kind or empty word is left out.
  expect(marksOf([{ text: "paracetamol", kind: "medicine" }, { text: " 1 g ", kind: "dose" }, { text: "chest pain", kind: "warning" }, { text: "", kind: "dose" }, { text: "x", kind: "sparkle" }]))
    .toEqual([{ text: "paracetamol", kind: "medicine" }, { text: "1 g", kind: "dose" }, { text: "chest pain", kind: "warning" }]);
  expect(marksOf([{ text: "low potassium of 3.1 mmol/L", kind: "alert" }, { text: "Hypokalaemia", kind: "finding" }])).toEqual([{ text: "low potassium of 3.1 mmol/L", kind: "warning" }, { text: "Hypokalaemia", kind: "condition" }]);
  // No marks at all (Care's word lists then colour) differs from the model choosing none.
  expect(marksOf(undefined)).toBeUndefined();
  expect(marksOf([])).toEqual([]);
});

test("every kind has a hue", () => {
  for (const kind of MARK_KINDS) expect(MARK_HUE[kind]).toBeString();
});

const medicine = { type: "medicine", name: "Azithromycin", dose: "500 mg", how: "after food", times: ["08:00"], source: "Your discharge plan" } as const;
const book = { type: "action", do: "book", title: "Clinic review with Dr. Lim", confirm: "Request", done: "Requested. The care team confirms it.", payload: { doctorId: "lim", startsAt: "2026-10-26T01:00:00.000Z" } } as const;

test("a card this app cannot read is left out, never the answer; a second action too", () => {
  const cards = cardsOf([
    medicine,
    { type: "chart", points: [1, 2] },
    { type: "result", test: "CRP", value: "86" },
    book,
    { ...book, do: "tellCareTeam", payload: { text: "Still coughing" } },
    { type: "doctor", id: "lim", name: "Dr. Lim Wei Jie", specialty: "Respiratory", room: "Clinic 3B", rating: 4.8, careTeam: true, about: "a newer field" },
  ]);
  expect(cards.map(c => c.type)).toEqual(["medicine", "action", "doctor"]);
  // A newer server's extra field is dropped, the card kept.
  expect(cards[2]).not.toHaveProperty("about");
  expect(cardsOf("cards")).toEqual([]);
  expect(cardsOf([{ ...book, payload: { doctorId: "lim", startsAt: "next Tuesday" } }])).toEqual([]);
});

test("a card's tone comes from its own facts", () => {
  const result = (flag?: string) => ({ type: "result", test: "Potassium", value: "3.1", unit: "mmol/L", source: "Lab result", ...flag && { flag } }) as AnswerCard;
  expect([result("critical"), result("low"), result("normal"), result()].map(toneOf)).toEqual(["urgent", "soon", "calm", "calm"]);
  const visit = (status: string) => ({ type: "appointment", title: "Clinic review", when: "2026-10-26T01:00:00.000Z", status }) as AnswerCard;
  expect(["confirmed", "requested", "missed", "upcoming"].map(s => toneOf(visit(s)))).toEqual(["good", "soon", "soon", "calm"]);
  expect(toneOf({ type: "warning", level: "urgent", title: "Call 999 now", items: [] })).toBe("urgent");
});

test("an answer's parts read loosely: an old answer has none, and the lane never carries a medical or emergency intent", () => {
  expect(partsOf({ answer: "Take it after food.", grounded: true })).toEqual({});
  expect(partsOf(undefined)).toEqual({});
  expect(partsOf({ marks: [{ text: "1 g", kind: "when" }], cards: [medicine], lane: { intent: "log_dose", confidence: 0.91, by: "clef-omni" } }))
    .toEqual({ marks: [{ text: "1 g", kind: "dose" }], cards: [medicine], lane: { intent: "log_dose", confidence: 0.91, by: "clef-omni" } });
  expect(partsOf({ lane: { intent: "emergency", confidence: 0.99, by: "clef-omni" } })).toEqual({});
  expect(partsOf({ lane: { intent: "medical_question", confidence: 0.99, by: "clef-omni" } })).toEqual({});
});
