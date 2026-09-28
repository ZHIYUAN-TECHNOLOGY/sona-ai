/**
 * Pure helpers for the Training data screen: the one-line insight, the leak line on a blocked
 * sample, and de-identified text split into its placeholders ([NAME], [IC], [PHONE], [EMAIL],
 * [MRN], and [LEAK] where the leak gate masked what the de-identifier missed).
 */
export type Placeholder = "NAME" | "IC" | "PHONE" | "EMAIL" | "MRN" | "LEAK";
export type Part = { text: string; placeholder?: Placeholder };
const PLACEHOLDER = /\[(NAME|IC|PHONE|EMAIL|MRN|LEAK)\]/g;

/** "[NAME] reports fever" → [{ text: "[NAME]", placeholder: "NAME" }, { text: " reports fever" }]. */
export function placeholderParts(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], placeholder: m[1] as Placeholder });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

const SPOKEN: Record<Placeholder, string> = { NAME: "name removed", IC: "IC removed", PHONE: "phone removed", EMAIL: "email removed", MRN: "record number removed", LEAK: "leaked identity masked" };
/** What VoiceOver reads instead of bracketed capitals. */
export const spoken = (text: string) => text.replace(PLACEHOLDER, (_, k: Placeholder) => SPOKEN[k]);

const KIND: Record<string, string> = { name: "name", ic: "IC", phone: "phone", email: "email", mrn: "record number" };
/** "Blocked by leak check · name and phone found". */
export const leakLine = (kinds: readonly string[] | null) =>
  `Blocked by leak check${kinds?.length ? ` · ${kinds.map(k => KIND[k] ?? k).join(" and ")} found` : ""}`;

const rows = (n: number) => `${n} row${n === 1 ? "" : "s"}`;
/** "3 waiting for review · 1 blocked · last dataset v1, 12 rows". */
export function insight({ counts, lastDataset }: { counts: { pending: number; blocked: number }; lastDataset: { version: number; rows: number } | null }) {
  return [
    counts.pending ? `${counts.pending} waiting for review` : "Nothing waiting for review",
    counts.blocked ? `${counts.blocked} blocked` : "",
    lastDataset ? `last dataset v${lastDataset.version}, ${rows(lastDataset.rows)}` : "no dataset yet",
  ].filter(Boolean).join(" · ");
}

/** The ward's entry row: "3 waiting · 1 blocked", or "Nothing to review". */
export const trainingLine = ({ pending, blocked }: { pending: number; blocked: number }) =>
  [pending ? `${pending} waiting` : "", blocked ? `${blocked} blocked` : ""].filter(Boolean).join(" · ") || "Nothing to review";

/** The export receipt: "v2 · 14 rows · leak check passed". */
export const exported = (r: { version: number; rows: number }) => `v${r.version} · ${rows(r.rows)} · leak check passed`;
