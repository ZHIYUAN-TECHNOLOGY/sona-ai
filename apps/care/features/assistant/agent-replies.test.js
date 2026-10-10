import { expect, test } from "bun:test";
import { DOCTORS } from "../doctors/data";
import { pairs, replyOf } from "./agent-replies";

const answered = (over = {}) => ({ answer: "Rest and drink water.", grounded: false, urgent: false, sources: [], withheld: 0, source: "model", model: "gemma", doctors: [], ...over });
const told = { taskId: "t1", title: "Amelia: chest pain", line: "I've let your care team know." };
const asks = [{ question: "When is my next visit?", answer: "Clinic review, Sun 11 Oct.", source: "From your discharge plan", kind: "visit" }];

test("the agent's answers read as care.ask's do: where each came from, the 999 card, the care team told", () => {
  expect(replyOf("How do I recover?", answered(), asks, "en").asked).toMatchObject({ answer: "Rest and drink water.", source: "General answer · not from your records" });
  expect(replyOf("What do I take?", answered({ grounded: true, sources: [{ title: "Recovering from pneumonia" }] }), asks, "en").asked)
    .toMatchObject({ source: "From your record", leaflet: "From the hospital's leaflet · Recovering from pneumonia" });
  // An emergency sign: the card, whatever the words, and the care team's line once the task exists.
  expect(replyOf("I have chest pain now", answered({ urgent: true, careTeam: told }), asks, "en")).toEqual({ kind: "none", urgent: true, careTeam: told });
  expect(replyOf("I feel strange", answered({ urgent: true }), asks, "en")).toEqual({ kind: "none", urgent: true });
});

test("no model: the plan's own answer to its question, or the honest no; the doctors it found as cards", () => {
  expect(replyOf("When is my next visit?", answered({ answer: "", source: "fixture", waking: 4 }), asks, "en")).toEqual({ kind: "plan", asked: asks[0], waking: 4 });
  expect(replyOf("Anything else?", answered({ answer: "Sona Care is starting.", source: "fixture" }), asks, "en")).toEqual({ kind: "none", urgent: false });
  expect(replyOf("Find me a lung doctor", answered({ answer: "Dr. Lim sees lungs.", doctors: [DOCTORS[0]] }), asks, "en"))
    .toEqual({ kind: "doctors", doctors: [DOCTORS[0]], text: "Dr. Lim sees lungs." });
});

test("her stored conversation becomes question and answer pairs; a question left unanswered is skipped", () => {
  const say = (role, text, metadata) => ({ role, parts: [{ type: "text", text }], metadata });
  const history = pairs([say("user", "Hi"), say("assistant", "Hello [1]", { source: "model", grounded: true }), say("user", "Lost"), say("user", "Again"), say("assistant", "Yes")]);
  expect(history.map(h => [h.question, h.answer.answer, h.answer.grounded])).toEqual([["Hi", "Hello", true], ["Again", "Yes", false]]);
});
