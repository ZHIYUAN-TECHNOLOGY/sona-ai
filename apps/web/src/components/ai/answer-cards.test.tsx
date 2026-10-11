// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";
import { type AnswerCard, cardsOf } from "@sona-ai/domain/answer-parts";
import { renderToStaticMarkup } from "react-dom/server";

import { CareMarked, Marked } from "@/components/marked";
import { CARE_FACTS, CARE_STEPS, PRO_CARDS } from "@/dev/answer-cards";
import { CareAnswer, shown999, sourceLines } from "@/features/care-ask/answer";

import { AnswerCards } from "./answer-cards";

const confirm = async () => {};
const html = (cards: AnswerCard[], app: "pro" | "care") => renderToStaticMarkup(<AnswerCards cards={cards} app={app} confirm={confirm} />);
// A doctor in Sona Care is a router link; rendered without a router here, so the doctor is drawn as Sona Pro would.
const noDoctor = CARE_FACTS.filter(c => c.type !== "doctor");

test("the fixtures are cards the server may send: every kind, at most 6 to an answer and one action", () => {
  for (const cards of [CARE_FACTS, CARE_STEPS, PRO_CARDS]) expect(cardsOf(cards)).toEqual(cards);
  expect(new Set([...CARE_FACTS, ...CARE_STEPS, ...PRO_CARDS].map(c => c.type))).toEqual(new Set(["medicine", "result", "reading", "appointment", "doctor", "warning", "steps", "action"]));
});

test("every card kind renders, each fact read as one sentence and every flag written as a word", () => {
  const care = html([...noDoctor, ...CARE_STEPS], "care"), pro = html([...PRO_CARDS, CARE_FACTS.find(c => c.type === "doctor")!], "pro");
  for (const s of [
    "Azithromycin, 500 mg, at 08:00, After food, 3 more days. Your discharge plan.", "Potassium 3.1 mmol/L, Low, usual range 3.5 to 5.1 mmol/L,",
    "Blood pressure 150/95 mmHg, High,", "Clinic review with Dr. Lim,", "Clinic 3B, Level 2, Confirmed.", ">Low<", ">High<", ">Confirmed<",
    "Call your care team if", "Normal for the first week", "Using your inhaler", "Hold your breath for 10 seconds", "Mark as taken", "Review before confirming",
  ]) expect(care).toContain(s);
  for (const s of [">Critical<", "Respiratory review,", ">Due soon<", "Act now", "Create task", "Dr. Lim Wei Jie, Respiratory, your care team, rated 4.8 of 5, Clinic 3B."]) expect(pro).toContain(s);
  // Colour from the card's own tone: critical and urgent red, high and low amber, confirmed green; facts' layout hidden behind their sentence.
  expect(pro).toContain('class="ai-card ai-card-warning" data-tone="urgent"');
  expect(pro).toContain('data-type="result" data-tone="urgent"');
  expect(care).toContain('data-type="appointment" data-tone="done"');
  expect(care).toContain('class="ai-fact-shown" aria-hidden="true"');
});

test("a drafted action is confirmed only in the app that does it; elsewhere its button is off and says where", () => {
  const book = CARE_FACTS.filter(c => c.type === "action"), task = PRO_CARDS.filter(c => c.type === "action");
  expect(html(book, "care")).not.toContain("disabled");
  expect(html(book, "pro")).toContain("Only the patient can do this, in Sona Care.");
  expect(html(task, "care")).toContain("Only the care team can do this, in Sona Pro.");
  expect(html(task, "pro")).toMatch(/<button[^>]*class="btn btn-primary"[^>]*>Create task/);
  expect(renderToStaticMarkup(<AnswerCards cards={task} app="pro" />)).toContain("disabled");
});

test("marks are drawn under today's kinds: the model's, and the word lists' old alert as warning", () => {
  expect(renderToStaticMarkup(<Marked text="Hypokalaemia on furosemide" />)).toContain('data-mark="warning">Hypokalaemia');
  expect(renderToStaticMarkup(<Marked text="K 3.1 on ECG" marks={[{ text: "ECG", kind: "test" }]} />)).toBe('K 3.1 on <span class="mark" data-mark="test">ECG</span>');
  expect(renderToStaticMarkup(<CareMarked text="Take 1 g of paracetamol" marks={[]} />)).toBe("Take 1 g of paracetamol");
  expect(renderToStaticMarkup(<CareMarked text="Take 1 g of paracetamol" />)).toContain('class="care-mark" data-mark="medicine">paracetamol');
});

test("a Sona Care answer: the 999 card first when urgent, the words kept, cards, then where it is from", () => {
  expect(sourceLines({ grounded: true, from: "warning signs" })).toEqual(["From your record · warning signs"]);
  expect(sourceLines({ grounded: true, from: "note", sources: [{ title: "Pneumonia" }] })).toEqual(["From your record · doctor's note", "From the hospital's leaflet · Pneumonia"]);
  expect(sourceLines({ grounded: false })).toEqual(["General answer · not from your records"]);
  const urgent = renderToStaticMarkup(<CareAnswer reply={{ answer: "Chest pain needs care now.", urgent: true, grounded: false, marks: [{ text: "Chest pain", kind: "warning" }], cards: [...CARE_STEPS.slice(0, 1), { type: "warning", level: "urgent", title: "Call 999 if", items: ["Chest pain"] }] }} />);
  expect(urgent.indexOf("Call 999 now")).toBeLessThan(urgent.indexOf("needs care now."));
  for (const s of ["Call 999 if", 'data-mark="warning">Chest pain</span> needs care now.', "Call your care team if", "General answer · not from your records"]) expect(urgent).toContain(s);
  // The urgent warning card becomes the 999 card, not a second red card.
  expect(urgent).not.toContain('data-tone="urgent"');
  expect(renderToStaticMarkup(<CareAnswer reply={{ answer: "Take it after food.", grounded: true }} />)).not.toContain("Call 999");
});

test("a 999 card a stream showed stays: in the whole answer without one, and when no answer comes", () => {
  const live = { sos: { type: "warning" as const, level: "urgent" as const, title: "Call 999 now", items: ["Chest pain"] }, words: "" };
  expect(renderToStaticMarkup(<CareAnswer reply={{ answer: "Rest now.", grounded: false }} live={live} />)).toContain("Call 999 now");
  expect(renderToStaticMarkup(<>{shown999(live)}</>)).toContain("Chest pain");
  expect(shown999({ words: "Rest" })).toBeNull();
});
