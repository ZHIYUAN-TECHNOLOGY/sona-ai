// Pure test for on-device note generation. No device, no native LLM.
//   npx tsx lib/pipeline/noteGen.test.ts
// Verifies think-stripping, transcript building, and the tolerant SOAP parser
// against a realistic Qwen3-style output, plus the no-drop fallback.

import assert from "node:assert/strict";

import type { KnowledgeDoc } from "../knowledge/corpus";
import { buildTranscript, classifyOrder, collapseRepeats, generateNote, normalizeModelMarkdown, parseFlags, parseSoap, stripThink, truncateDegenerate } from "./noteGen";
import { buildGuidelineContext } from "./noteGrounding";
import { highlightClinical, normalizeNoteMarkdown } from "./noteHighlight";
import { soapToMarkdown } from "./noteFormat";

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

// --- hardened highlighter: negation, units, timeframes, code-switch --------
// Regression corpus distilled from the adversarial hardening sweep. hasRed/Blue/Green
// read the emphasis channels the renderer colours.
{
  const H = (s: string, f?: string[]) => highlightClinical(normalizeNoteMarkdown(s), f);
  const hasRed = (s: string) => /`[^`]+`/.test(s);
  const hasBlue = (s: string) => /(^|[^*])\*[^*]+\*/.test(s);
  const hasGreen = (s: string) => /\*\*[^*]+\*\*/.test(s);

  // Negation — DENIED / ABSENT / RULED-OUT symptoms must NOT be red (patient safety).
  ok(!hasRed(H("Chest pain denied.")), "post-nominal: 'X denied'");
  ok(!hasRed(H("Chest pain: nil.")), "post-nominal: 'X: nil'");
  ok(!hasRed(H("Chest pain resolved, now comfortable.")), "post-nominal: 'X resolved'");
  ok(!hasRed(H("Chest pain ruled out after normal ECG.")), "post-nominal: 'X ruled out'");
  ok(!hasRed(H("Denies chest pain, breathlessness and haemoptysis.")), "list-carry across commas");
  ok(!hasRed(H("Patient is free of chest pain and breathlessness.")), "cue 'free of'");
  ok(!hasRed(H("No cough, chest pain, or shortness of breath reported.")), "'No … reported' list");
  ok(!hasRed(H("Patient doesn't have chest pain.")), "contraction: doesn't");

  // Scope-reset — a PRESENT symptom after 'but'/'now reports' must stay red.
  ok(hasRed(H("No fever but has chest pain.")), "scope-reset on 'but'");
  ok(hasRed(H("Patient has no allergies and now reports chest pain.")), "scope-reset on 'now reports'");
  ok(hasRed(H("No chest pain at rest but chest pain on exertion.")), "exertional CP survives leading 'No'");

  // Malay negation + Malay red flags.
  ok(!hasRed(H("Pesakit tiada chest pain")), "Malay cue 'tiada'");
  ok(!hasRed(H("Tidak sesak, tidak chest pain")), "Malay cue 'tidak' distributes");
  ok(hasRed(H("Batuk darah sejak semalam")), "Malay red flag 'batuk darah'");
  ok(hasRed(H("Sesak nafas bila baring")), "Malay red flag 'sesak nafas'");
  ok(hasRed(H("No fever tapi chest pain makin teruk")), "Malay scope-reset 'tapi'");

  // Dose & vital (green) + address/percentage safety (NOT green).
  ok(hasGreen(H("Weight 12 kg, otherwise well")), "weight kg");
  ok(hasGreen(H("RBS 15 mmol/L, ketones negative")), "glucose mmol/L");
  ok(hasGreen(H("PCM 1-2 tablets QID PRN")), "range dose + frequency");
  ok(hasGreen(H("Clonazepam .5 mg nocte")), "leading-decimal dose");
  ok(hasGreen(H("Hb 12g/dL, weight 72kg.")), "g/dL and kg, not split");
  ok(!hasGreen(H("Lives at 12G Jalan Ampang.")), "address '12G' is not a dose");
  ok(!hasGreen(H("Compliance improved by 20%")), "bare percentage is not a vital");
  // A labelled vital ending in a bare unit must not be double-wrapped (GREEN + DOSE_BARE).
  ok(!H("Wt 70 g").includes("**Wt **"), "labelled vital + bare gram not double-wrapped");
  ok(!H("Birth weight 3200 g, feeding well").includes("**weight **"), "neonatal weight not split");

  // Timeframes (blue) incl. Commonwealth shorthand + Malay.
  ok(hasBlue(H("3/7 history of fever, cough productive")), "shorthand 3/7");
  ok(hasBlue(H("3-day history of cough and fever")), "hyphenated 3-day");
  ok(hasBlue(H("Fever for 2-3 days, worse at night")), "range 2-3 days");
  ok(hasBlue(H("Demam dah tiga hari, malam lagi teruk")), "Malay word-number 'tiga hari'");
  ok(hasBlue(H("Batuk 2 minggu, kahak hijau")), "Malay unit 'minggu'");

  // Mixed line: dose + frequency + timeframe together.
  const mix = H("Augmentin 625mg BD for 5 days");
  ok(hasGreen(mix) && hasBlue(mix), "green dose + blue duration in one line");
}

// --- editable notes: rendered markdown -> parseSoap round-trips -----------
// The clinician edits the rebuilt note Markdown; editClinicalNote parses it back to
// SOAP + orders. This locks the render->parse contract that edit relies on.
{
  const soap = {
    subjective: "Cough for 3 days.",
    objective: "Temp 38.2, chest clear.",
    assessment: "Viral URTI.",
    plan: "Paracetamol PRN.",
  };
  const orders = [
    { kind: "review" as const, text: "Review in 1 week if not better" },
    { kind: "test" as const, text: "FBC if fever persists" },
  ];
  const md = soapToMarkdown(soap, orders);
  const back = parseSoap(md);
  ok(back.soap.subjective.includes("Cough for 3 days"), "edit round-trip: subjective");
  ok(back.soap.assessment.includes("Viral URTI"), "edit round-trip: assessment");
  ok(back.orders.length === 2 && back.orders[0].text.includes("Review in 1 week"), "edit round-trip: orders");
  // A hand-edit still re-parses cleanly.
  const edited = md.replace("Paracetamol PRN.", "Paracetamol 1g QID PRN and oral fluids.");
  const backEdited = parseSoap(edited);
  ok(backEdited.soap.plan.includes("oral fluids"), "edited plan text re-parses");
  ok(!backEdited.soap.plan.includes("Review in 1 week"), "orders stay out of the plan body after edit");
}

// --- fallback: model ignored the format -----------------------------------
const messy = parseSoap("Patient has a cough, likely viral. Advised rest.");
ok(
  messy.soap.subjective.includes("Patient has a cough") && messy.orders.length === 0,
  "unparseable output falls back into subjective, nothing dropped",
);

// --- grounded note-gen: buildGuidelineContext + prompt injection ----------
{
  const corpus: KnowledgeDoc[] = [
    { id: "cp", title: "Chest pain red flags", text: "Refer urgently if central chest pain with breathlessness.", category: "red-flags", source: "NICE", keywords: ["chest pain", "sakit dada"] },
    { id: "ankle", title: "Ankle sprain", text: "RICE; refer if unable to weight-bear.", category: "referral", source: "NICE", keywords: ["ankle"] },
  ];
  const g = buildGuidelineContext("patient reports central chest pain and breathlessness", corpus, 3);
  ok(g.refs.length >= 1 && g.refs[0].id === "cp", "grounding retrieves the relevant guideline");
  ok(g.context.includes("[G1] Chest pain red flags"), "context is numbered for citation");
  ok(buildGuidelineContext("xyzzy nothing", corpus).context === "", "no match → empty context");
}

// --- generateNote injects the guideline context into the system prompt -----
void (async () => {
  let capturedSystem = "";
  const mockLlm = {
    generate: async (msgs: { role: string; content: string }[]) => {
      capturedSystem = msgs.find((m) => m.role === "system")?.content ?? "";
      return "Title: URTI\n## Subjective\nCough for 3 days.\n\nFlags: none";
    },
  };
  const segs = [{ speaker: "patient" as const, text: "I have a cough." }];
  const withCtx = await generateNote(mockLlm, segs, "BASE PROMPT.", "[G1] Chest pain: refer if central.");
  ok(capturedSystem.includes("[G1] Chest pain"), "guideline context injected into the system prompt");
  ok(capturedSystem.includes("BASE PROMPT."), "base prompt preserved when grounding");
  ok(Array.isArray(withCtx.guidelines), "DraftNote carries a guidelines array");

  capturedSystem = "";
  await generateNote(mockLlm, segs, "BASE PROMPT.");
  ok(capturedSystem === "BASE PROMPT.", "no context → prompt unchanged (additive)");

  // collapseRepeats — degenerate loop collapses to one sentence; distinct content survives.
  const looped = "He is well. " + "He is not on any current medical treatment. ".repeat(30).trim();
  const collapsed = collapseRepeats(looped);
  ok(collapsed === "He is well. He is not on any current medical treatment.", "30x repeated sentence -> 1");
  ok(collapseRepeats("## Plan\n- rest\n- rest more") === "## Plan\n- rest\n- rest more", "markdown lines untouched");
  ok(collapseRepeats("A. B. A.") === "A. B. A.", "non-adjacent repeats preserved");

  // truncateDegenerate — cuts synonym waterfalls + alphabet soup, keeps real notes.
  const adverbs = "## Plan\n- rest and fluids\nmet appropriately thoroughly comprehensively accurately faithfully diligently conscientiously carefully meticulously attentively zealously enthusiastically fervently ardently";
  ok(truncateDegenerate(adverbs) === "## Plan\n- rest and fluids", "adverb waterfall truncated");
  const soup = "## Assessment\n- viral URTI likely\naaa bbb ccc dd ee ff gg hh iii jj kk ll mm nn oo pp";
  ok(truncateDegenerate(soup) === "## Assessment\n- viral URTI likely", "alphabet soup truncated");
  const good = "## Subjective\n- cough one week, sore throat, poor sleep\n## Plan\n- paracetamol 500 mg twice daily for three days if fever";
  ok(truncateDegenerate(good) === good, "normal note untouched");
  ok(truncateDegenerate("病人咳嗽一周，喉咙很痛，晚上睡不好，没有发烧，胃口正常，无其他不适症状。") !== "", "CJK line untouched");

  // eslint-disable-next-line no-console
  console.log(`noteGen: ${checks}/${checks} checks pass`);
})();

// --- truncateDegenerate: spaceless mega-token degeneration (field, Jul 14 2026) ---
{
  const soup =
    "## Plan\n- Review in one week\n- DOCNAME:WHITETUSSMALLPACIENTREVIEWDATE:DEC79BECFDEEEDCFFAAADCCBFBCABDBFAEBDXXXXXXYYYYYZZZ\n- never reached";
  const t = truncateDegenerate(soup);
  assert(!t.includes("WHITETUSS"), "spaceless letter-soup line must be truncated");
  assert(t.includes("Review in one week"), "content before the soup survives");

  const zh = "## Subjective\n- 患者说喉咙很痛已经三天了晚上睡不好胃口也不好而且有一点发烧和咳嗽的情况持续中";
  assert(truncateDegenerate(zh).includes("喉咙很痛"), "long spaceless CJK line must SURVIVE");

  const runs = "## Plan\n- follow up XXXXXXX soon";
  assert(!truncateDegenerate(runs).includes("XXXXXXX"), "identical-char run line truncated");
  console.log("truncateDegenerate spaceless: 3/3 checks pass");
}

// --- normalizeModelMarkdown: Qwen3-4B dirty output (field screenshot #146, Jul 14 2026) ---
{
  const raw = [
    "Title：Cough persisting with yellow sputum",
    "##Subjective",
    "· Cough lasting three Days， worse overnight",
    "##Objective",
    "–Temperature ＊",
    "—Pulse",
    "–Oxygen saturation ％",
    "###Plan",
    "----If Fever Or Severe Breathlessness return early",
    "",
    "Note : The above has been formatted strictly according to instructions; all data from transcripts have been included without addition of any information .",
  ].join("\n");
  const n = normalizeModelMarkdown(raw);
  assert(n.includes("Title: Cough"), "full-width colon folded to ASCII");
  assert(/^## Subjective$/m.test(n), "space inserted after ## heading");
  assert(/^### Plan$/m.test(n), "space inserted after ### heading");
  assert(/^- Pulse$/m.test(n), "em-dash bullet folded to '- '");
  assert(/^- Temperature \*$/m.test(n), "en-dash bullet + full-width asterisk folded");
  assert(/^- Cough lasting three Days, worse overnight$/m.test(n), "middle-dot bullet + full-width comma folded");
  assert(/^- If Fever/m.test(n), "dash-run bullet collapsed to '- '");
  assert(!/formatted strictly according to instructions/.test(n), "trailing self-narration dropped");
  console.log("normalizeModelMarkdown: 8/8 checks pass");
}
