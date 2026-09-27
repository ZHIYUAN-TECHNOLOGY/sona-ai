import { expect, test } from "bun:test";
import { suggestions, urgent } from "./answers";

const medicines = {
  new: [{ name: "Paracetamol", line: "For pain or fever: 1 g every 6 hours if you need it, no more than 4 g a day" }],
  changed: [{ name: "Azithromycin", line: "Now a tablet once a day, for 2 more days", take: "1 tablet, with or without food", at: ["08:00"], doses: 2 }],
  stopped: [{ name: "Salbutamol nebuliser", line: "Use your own inhaler instead, when you need it" }],
  continue: [{ name: "Cetirizine", line: "Keep taking it as before", take: "1 tablet at night", at: ["21:00"] }],
};
const leaflets = [{ language: "en", label: "EN", name: "English", text: "You were treated for a chest infection. Take azithromycin once a day for 2 more days." }];
const plan = { medicines, leaflets };
const visit = { title: "Clinic review", date: new Date("2026-10-11T02:00:00Z"), why: "To see how you're doing after your pneumonia", inDays: 14 };

test("three questions from the plan: the next dose, the new medicine, the next visit", () => {
  const [miss, fresh, next, ...rest] = suggestions(plan, visit, "Cetirizine");
  expect(rest).toEqual([]);
  expect(miss.question).toBe("What if I miss a dose of Cetirizine?");
  expect(miss.answer).toBe("Your plan doesn't say what to do if you miss a dose of Cetirizine, so ask your care team. Never take two doses at once to make up for one. Your usual dose: 1 tablet at night, at 9:00 PM.");
  expect(miss.source).toBe("From your Cetirizine instructions");
  expect(fresh).toEqual({ question: "What is Paracetamol for?", answer: "Your plan says: For pain or fever: 1 g every 6 hours if you need it, no more than 4 g a day.", source: "From your Paracetamol instructions" });
  expect(next).toEqual({ question: "When is my next visit?", answer: "Clinic review, Sun 11 Oct (in 14 days). To see how you're doing after your pneumonia.", source: "From your discharge plan" });
});

test("the missed-dose answer follows the plan's own wording when it has one, and still says never two at once", () => {
  const worded = { medicines, leaflets: [{ ...leaflets[0], text: "Take azithromycin once a day. If you forget a dose, take it when you remember that day. Rest well." }] };
  const [miss] = suggestions(worded, undefined);
  expect(miss.question).toBe("What if I miss a dose of Azithromycin?"); // no next dose given: the first medicine on a schedule
  expect(miss.answer).toBe("Your plan says: If you forget a dose, take it when you remember that day. Never take two doses at once to make up for one.");
  expect(miss.source).toBe("From your discharge plan");
});

test("with no new medicine it asks what changed; with nothing planned it offers nothing", () => {
  const [, changed] = suggestions({ medicines: { ...medicines, new: [] }, leaflets }, undefined, "Azithromycin");
  expect(changed).toEqual({ question: "What changed with Azithromycin?", answer: "Your plan says: Now a tablet once a day, for 2 more days.", source: "From your Azithromycin instructions" });
  expect(suggestions(undefined, undefined)).toEqual([]);
  expect(suggestions({ medicines: { new: [], changed: [], stopped: [], continue: [] }, leaflets }, undefined)).toEqual([]);
});

test("urgent words put the 999 line first; everyday questions do not", () => {
  for (const t of ["I have chest pain", "my chest feels tight", "pain in my chest", "I'm short of breath", "can't breathe properly", "I fainted this morning", "I passed out", "coughing up blood", "the wound is bleeding", "my lips look blue", "I want to end my life"])
    expect(urgent(t)).toBe(true);
  for (const t of ["Can I drink coffee?", "What is my blood pressure target?", "When can I drive again?", "Can I take it with food?"])
    expect(urgent(t)).toBe(false);
});
