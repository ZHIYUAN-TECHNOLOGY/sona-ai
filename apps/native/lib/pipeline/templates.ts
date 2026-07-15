import type { Ionicons } from "@expo/vector-icons";

/** A note template: a name + icon for the picker, and the markdown structure the
 *  model should produce. All templates share the same de-identification / PII /
 *  title rules (BASE_RULES); only the section structure differs. */
export interface NoteTemplate {
  id: string;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
  /** The per-template structure spec appended to BASE_RULES. */
  structure: string;
}

// Shared rules — identical safety + formatting contract for every template. The structure
// stays rigid (the small note model rambles and invents when given latitude) but bullets are
// full clinical statements, not telegrams: the earlier 12-word/150-word caps read as skimpy,
// low-quality notes to clinicians (user feedback Jul 15). Caps stay — just roomier — because
// an unbounded note is how small models dissolve into token-cap rambles.
// ANY change here must be mirrored into tools/note-eval/harness.py and re-scored vs the
// incumbent baseline BEFORE it ships (same gate as a model swap).
const BASE_RULES =
  "You are a clinical documentation assistant. Convert the de-identified consultation " +
  "transcript into a clear, complete clinical note in English.\n" +
  "OUTPUT FORMAT (exactly):\n" +
  "Line 1 — 'Title: ' + 3-6 word clinical summary (no names, IC, phones, addresses, tokens).\n" +
  "Then the sections below as '## ' Markdown headings. Each section: 2-5 bullet points " +
  "('- '). Each bullet is one complete, natural clinical statement under 20 words — written " +
  "the way a doctor writes, never fragmented single words.\n" +
  "HARD RULES:\n" +
  "- Use ONLY facts stated in the transcript. NEVER invent symptoms, findings, diagnoses, " +
  "medications, doses, demographics (age, sex), or history.\n" +
  "- The transcript may mix Malay and English. Write the note in standard English clinical " +
  "language, translating Malay clinical content faithfully ('saya tak demam' → 'no fever'; " +
  "'batuk berkahak' → 'productive cough'). Never leave untranslated Malay in the note; " +
  "never guess at an unclear phrase — omit what you cannot understand.\n" +
  "- A section with nothing in the transcript = exactly '- Not discussed.'\n" +
  "- No tables, no links, no citations, no [G1]-style references, no asterisks, no preamble, " +
  "no closing remarks, no repetition.\n" +
  "- Keep identifier tokens such as NAME_1 exactly as written.\n" +
  "- Total note under 250 words.\n" +
  "- COMPLETENESS: include EVERY medication, dose, duration, vital sign, and follow-up " +
  "instruction stated in the transcript. Omitting a stated fact is as wrong as inventing one.";

export const TEMPLATES: NoteTemplate[] = [
  {
    id: "auto",
    name: "Auto",
    icon: "sparkles-outline",
    description: "Picks the best format for this visit",
    structure:
      "Choose the most appropriate clinical note format for this visit and structure it with clear " +
      "'## ' Markdown headings, ending with a '## Orders & follow-ups' bulleted list where relevant.",
  },
  {
    id: "soap",
    name: "SOAP note",
    icon: "medkit-outline",
    description: "Subjective · Objective · Assessment · Plan",
    structure:
      "Structure: '## Subjective', '## Objective', '## Assessment', '## Plan', then a final " +
      "'## Orders & follow-ups' heading with a '- ' bulleted list covering review intervals, tests " +
      "ordered, medications with doses, and safety-net advice the clinician stated." +
      // Few-shot example — harness-proven (note-eval, Jul 2026): inventions 2→0 at equal
      // recall vs rules-only. SOAP is the default/demo template; other templates rely on
      // BASE_RULES' completeness clause alone.
      "\n\nEXAMPLE (follow this shape exactly — note EVERY stated symptom, vital, medication and " +
      "follow-up is captured):\n" +
      "Transcript:\ndoctor: NAME_1, sore throat how many days?\npatient: Four days doctor, pain when " +
      "swallow, and very itchy eyes also. Saya tak demam.\ndoctor: Temperature 37.1, throat red, no pus. " +
      "Tonsillitis, likely viral. Salt water gargle, cetirizine 10 milligram at night for the eyes. " +
      "Come back in five days if not better, earlier if fever or cannot swallow.\n" +
      "Output:\n" +
      "Title: Sore throat with itchy eyes\n" +
      "## Subjective\n- Sore throat for four days with pain on swallowing\n- Itchy eyes accompanying the sore throat\n- No fever reported\n" +
      "## Objective\n- Temperature 37.1\n- Throat erythematous with no pus seen\n" +
      "## Assessment\n- Tonsillitis, likely viral\n" +
      "## Plan\n- Salt water gargle for symptomatic relief\n- Cetirizine 10 mg at night for the itchy eyes\n" +
      "## Orders & follow-ups\n- Review in five days if not better\n- Return earlier if fever develops or swallowing becomes impossible",
  },
  {
    id: "progress",
    name: "Progress note",
    icon: "document-text-outline",
    description: "Narrative interval update",
    structure:
      "Structure: '## Interval history', '## Examination', '## Impression', '## Plan', then " +
      "'## Orders & follow-ups' with a '- ' bulleted list.",
  },
  {
    id: "referral",
    name: "Referral letter",
    icon: "mail-outline",
    description: "Letter to a specialist",
    structure:
      "Structure as a referral letter with headings '## Reason for referral', '## Clinical history', " +
      "'## Examination findings', and '## Request', written as concise prose paragraphs.",
  },
  {
    id: "discharge",
    name: "Discharge summary",
    icon: "exit-outline",
    description: "Visit summary + follow-up",
    structure:
      "Structure: '## Presenting complaint', '## Assessment', '## Treatment given', " +
      "'## Discharge advice', '## Follow-up'.",
  },
];

export const DEFAULT_TEMPLATE = TEMPLATES[1]; // SOAP

export function templateById(id: string | undefined): NoteTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? DEFAULT_TEMPLATE;
}

/** Full system prompt for a template = shared rules + its structure. */
export function templatePrompt(t: NoteTemplate): string {
  return `${BASE_RULES}\n\n${t.structure}`;
}
