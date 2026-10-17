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

/** One word as laid out on the card: its runs (a placeholder stays attached to its punctuation, "[NAME]'s") and whether a space follows. */
export type Word = { parts: Part[]; space: boolean };
/** De-identified text as words, so each placeholder can be its own animated chip and still wrap with its punctuation. */
export function redactedWords(text: string): Word[] {
  const words: Word[] = [];
  let parts: Part[] = [];
  const end = () => {
    if (parts.length) words.push({ parts, space: true });
    else if (words.length) words[words.length - 1]!.space = true;
    parts = [];
  };
  for (const part of placeholderParts(text)) {
    if (part.placeholder) { parts.push(part); continue; }
    for (const piece of part.text.split(/(\s+)/)) if (piece) /^\s+$/.test(piece) ? end() : parts.push({ text: piece });
  }
  if (parts.length) words.push({ parts, space: false });
  return words;
}

const SPOKEN: Record<Placeholder, string> = { NAME: "name removed", IC: "IC removed", PHONE: "phone removed", EMAIL: "email removed", MRN: "record number removed", LEAK: "leaked identity masked" };
/** What VoiceOver reads instead of bracketed capitals. */
export const spoken = (text: string) => text.replace(PLACEHOLDER, (_, k: Placeholder) => SPOKEN[k]);

const KIND: Record<string, string> = { name: "name", ic: "IC", phone: "phone", email: "email", mrn: "record number" };
/** "Blocked by leak check · name and phone found". */
export const leakLine = (kinds: readonly string[] | null) =>
  `Blocked by leak check${kinds?.length ? ` · ${kinds.map(k => KIND[k] ?? k).join(" and ")} found` : ""}`;

const REMOVED: [Placeholder, string, string, string][] = [["NAME", "name", "name", "names"], ["IC", "ic", "IC number", "IC numbers"], ["PHONE", "phone", "phone number", "phone numbers"], ["EMAIL", "email", "email", "emails"], ["MRN", "mrn", "record number", "record numbers"]];
/** What a sample's de-identifier took out, and who ("OpenMed" removed "4 names", "1 phone number"), each count with the placeholder it left (the card tints it to match). */
export function removed(replacements: readonly { kind: string }[], deidentifier: string) {
  const who = deidentifier === "rules" ? "Rules" : deidentifier.split("/")[0]!;
  const counts = REMOVED.flatMap(([placeholder, kind, one, many]) => {
    const n = replacements.filter(r => r.kind === kind).length;
    return n ? [{ placeholder, text: `${n} ${n === 1 ? one : many}` }] : [];
  });
  return { who, counts };
}

const rows = (n: number) => `${n} row${n === 1 ? "" : "s"}`;
/** "Sharing off · 3 waiting for review · 1 blocked · last dataset v1, 12 rows". */
export function insight({ contributes, counts, lastDataset }: { contributes: boolean; counts: { pending: number; blocked: number }; lastDataset: { version: number; rows: number } | null }) {
  return [
    contributes ? "" : "sharing off",
    counts.pending ? `${counts.pending} waiting for review` : "nothing waiting for review",
    counts.blocked ? `${counts.blocked} blocked` : "",
    lastDataset ? `last dataset v${lastDataset.version}, ${rows(lastDataset.rows)}` : "no dataset yet",
  ].filter(Boolean).join(" · ").replace(/^./, c => c.toUpperCase());
}

/** The ward's entry row: "3 waiting · 1 blocked", or "Nothing to review". */
export const trainingLine = ({ pending, blocked }: { pending: number; blocked: number }) =>
  [pending ? `${pending} waiting` : "", blocked ? `${blocked} blocked` : ""].filter(Boolean).join(" · ") || "Nothing to review";

/** The export receipt: "v2 · 14 rows · leak check passed". */
export const exported = (r: { version: number; rows: number }) => `v${r.version} · ${rows(r.rows)} · leak check passed`;
