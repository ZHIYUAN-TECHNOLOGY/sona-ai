// Pure test for on-device note generation. No device, no native LLM.
//   npx tsx lib/pipeline/noteGen.test.ts
// Verifies think-stripping, transcript building, and the tolerant SOAP parser
// against a realistic Qwen3-style output, plus the no-drop fallback.

import assert from "node:assert/strict";

import { buildTranscript, classifyOrder, parseFlags, parseSoap, stripThink } from "./noteGen";
import { highlightClinical } from "./noteHighlight";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

// --- stripThink -----------------------------------------------------------
ok(
  stripThink("<think>let me reason\nabout this</think>\nSubjective: cough") ===
    "Subjective: cough",
  "closed <think> block removed",
);
ok(
  stripThink("Subjective: cough<think>truncated reasoning with no close") === "Subjective: cough",
  "dangling unclosed <think> drops trailing scratchpad",
);
ok(stripThink("no think here") === "no think here", "text without think untouched");

// --- buildTranscript ------------------------------------------------------
const transcript = buildTranscript([
  { speaker: "doctor", text: "Morning NAME_1, how is the cough?" },
  { speaker: "patient", text: "Demam tiga hari." },
]);
ok(transcript.includes("Doctor: Morning NAME_1"), "doctor line labelled + token kept");
ok(transcript.includes("Patient: Demam tiga hari."), "patient line labelled");

// --- parseSoap on a realistic Qwen3 output --------------------------------
const model = `<think>
The patient has a cough. I will structure this as SOAP.
</think>
Subjective: NAME_1, a 58 year old man, reports a productive cough for three days with fever, worse at night. No chest pain.

Objective: Temperature 38.2, pulse 92, oxygen saturation 97 percent. Throat erythematous, chest clear.

Assessment: Viral upper respiratory tract infection, no red flags.

Plan: Paracetamol one gram four times a day as needed. Oral fluids and rest.

Orders & follow-ups:
- Review in one week if symptoms persist
- Full blood count if fever does not settle
- Return immediately if significantly breathless
`;

const parsed = parseSoap(stripThink(model));
ok(parsed.soap.subjective.startsWith("NAME_1, a 58 year old man"), "subjective parsed, token kept");
ok(parsed.soap.objective.includes("Temperature 38.2"), "objective parsed");
ok(parsed.soap.assessment.includes("Viral upper respiratory"), "assessment parsed");
ok(parsed.soap.plan.includes("Paracetamol one gram"), "plan parsed");
ok(!parsed.soap.plan.toLowerCase().includes("review in one week"), "orders not left in plan body");
ok(parsed.orders.length === 3, "three orders extracted");
ok(
  parsed.orders[0].kind === "review" &&
    parsed.orders[1].kind === "test" &&
    parsed.orders[2].kind === "safety-net",
  "orders classified: review, test, safety-net",
);

// --- classifyOrder --------------------------------------------------------
ok(classifyOrder("Paracetamol one gram four times a day") === "medication", "medication classified");
ok(classifyOrder("FBC if fever does not settle") === "test", "test classified");
ok(classifyOrder("Review in one week") === "review", "review classified");
ok(classifyOrder("Return if breathless") === "safety-net", "safety-net classified");
ok(classifyOrder("Oral fluids and rest") === "other", "other classified");

// --- parseFlags (hybrid highlighter sidecar) ------------------------------
{
  const withFlags = `## Assessment\nViral URTI.\n\nFlags: breathlessness; haemoptysis`;
  const { flags, rest } = parseFlags(withFlags);
  ok(flags.length === 2 && flags[0] === "breathlessness" && flags[1] === "haemoptysis", "flags split on ;");
  ok(!rest.includes("Flags:"), "flags line peeled off the body");

  ok(parseFlags("## Plan\nRest.\n\nFlags: none").flags.length === 0, "'none' → no flags");
  ok(parseFlags("## Plan\nRest.").flags.length === 0, "no Flags line → empty");
  // Defence in depth: a stray token must never survive into a flag phrase.
  ok(parseFlags("Flags: chest pain NAME_1").flags[0] === "chest pain", "token stripped from flag");
}

// --- highlightClinical: model flags + negation guard ----------------------
{
  // Model-supplied flags drive the red channel (dynamic, not the fixed lexicon).
  const h = highlightClinical("Patient reports palpitations today.", ["palpitations"]);
  ok(h.includes("`palpitations`"), "model flag highlighted even though not in lexicon");

  // Negation guard: "no chest pain" must NOT be red-flagged (the old bug).
  const neg = highlightClinical("No chest pain or breathlessness reported.", ["chest pain", "breathlessness"]);
  ok(!neg.includes("`chest pain`") && !neg.includes("`breathlessness`"), "negated symptoms not highlighted");

  // Present red flag in a later clause of the same line still highlights.
  const mixed = highlightClinical("Denies fever, but has chest pain.", ["fever", "chest pain"]);
  ok(!mixed.includes("`fever`") && mixed.includes("`chest pain`"), "clause-scoped negation");

  // Numbers stay deterministic and the "1 gram" boundary bug stays fixed.
  const dose = highlightClinical("Paracetamol 1 gram for 3 days.", []);
  ok(dose.includes("**1 gram**") && !dose.includes("**1 g**"), "dose highlighted whole, no 'g' bleed");
  ok(dose.includes("*3 days*"), "duration highlighted blue");
}

// --- fallback: model ignored the format -----------------------------------
const messy = parseSoap("Patient has a cough, likely viral. Advised rest.");
ok(
  messy.soap.subjective.includes("Patient has a cough") && messy.orders.length === 0,
  "unparseable output falls back into subjective, nothing dropped",
);

// eslint-disable-next-line no-console
console.log(`noteGen: ${checks}/${checks} checks pass`);
