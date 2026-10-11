import { PRO_CARDS } from "../answer-cards";
import { fixture } from "./fixture";

// Sona Pro's panel answer (ask.free, scope "web"): a lead with the model's marks in Pro's old kinds (alert, finding:
// read as warning and condition), rows, and a card of every kind Sona Pro shows with a drafted task (answer-parts).
const LEAD = "Amelia Tan's potassium of 6.4 mmol/L is critical (hyperkalaemia). Repeat it with an ECG now and hold spironolactone; her SpO2 of 91% is not yet confirmed on a repeat.";
const model = {
  source: "model" as const, model: "gemma-4-26b-a4b", spec: {
    root: "r", elements: {
      r: { type: "AskColumn", props: {}, children: ["lead", "rows"] },
      lead: { type: "AskLead", props: { text: LEAD }, children: [] },
      rows: { type: "AskRows", props: { rows: [
        { id: "p1", title: "Amelia Tan · 4B-12", detail: "Potassium 6.4 at 06:00, not acknowledged", tone: "urgent", op: "open:p1" },
        { id: "p2", title: "Lim Wei Jie · 4B-3", detail: "Discharge blocked: waiting on transport", tone: "soon", op: "open:p2" },
      ] }, children: [] },
    },
  },
};
const MARKS = [
  { text: "potassium of 6.4 mmol/L", kind: "alert" }, { text: "hyperkalaemia", kind: "finding" }, { text: "ECG", kind: "test" },
  { text: "spironolactone", kind: "medicine" }, { text: "SpO2 of 91%", kind: "test" }, { text: "not yet confirmed", kind: "caution" },
];

export default [
  fixture("ask.free", { worst: { ...model, marks: MARKS, cards: PRO_CARDS } as typeof model, one: { ...model, general: true } as typeof model }),
];
