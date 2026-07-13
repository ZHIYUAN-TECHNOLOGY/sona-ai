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

// Shared rules — identical safety + formatting contract for every template. Deliberately SHORT
// and rigid: the 1.5B note model rambles and invents when given latitude, so the contract is
// terse bullets, hard caps, and nothing beyond the transcript.
const BASE_RULES =
  "You are a clinical documentation assistant. Convert the de-identified consultation " +
  "transcript into a SHORT clinical note in English.\n" +
  "OUTPUT FORMAT (exactly):\n" +
  "Line 1 — 'Title: ' + 3-6 word clinical summary (no names, IC, phones, addresses, tokens).\n" +
  "Then the sections below as '## ' Markdown headings. Each section: 1-3 bullet points " +
  "('- '), each bullet under 12 words. Plain factual clinical language.\n" +
  "HARD RULES:\n" +
  "- Use ONLY facts stated in the transcript. NEVER invent symptoms, findings, diagnoses, " +
  "medications, doses, demographics (age, sex), or history.\n" +
  "- A section with nothing in the transcript = exactly '- Not discussed.'\n" +
  "- No tables, no links, no citations, no [G1]-style references, no asterisks, no preamble, " +
  "no closing remarks, no repetition.\n" +
  "- Keep identifier tokens such as NAME_1 exactly as written.\n" +
  "- Total note under 150 words.";

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
      "ordered, medications with doses, and safety-net advice the clinician stated.",
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
