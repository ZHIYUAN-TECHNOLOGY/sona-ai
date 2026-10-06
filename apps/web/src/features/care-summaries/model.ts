/** An approved after-visit summary, as `care.visitSummaries.list` returns it. */
export type Summary = { id: string; at: Date | string; text: string; whatChanged: string[] };

const sentencesOf = (text: string) => text.split(/(?<=[.!?。！？])\s+/).map(s => s.trim()).filter(Boolean);

/** The writer's own paragraphs when the text has them; otherwise two sentences to a paragraph, so no block is long. */
export function paragraphsOf(text: string): string[] {
  const own = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (own.length > 1) return own;
  const sentences = sentencesOf(text), out: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) out.push(sentences.slice(i, i + 2).join(" "));
  return out;
}

/** Malaysia time, in the reader's language. */
export const dateOf = (at: Date | string, locale: string, long = false) =>
  new Date(at).toLocaleDateString(locale, { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: long ? "long" : "short", ...(long ? { year: "numeric" } : {}) });

/** The start of the text, cut at a word, for a row in the list of visits. */
export const firstWords = (text: string, max = 60) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, flat.lastIndexOf(" ", max) > 0 ? flat.lastIndexOf(" ", max) : max)}…`;
};

/** A paragraph that opens with its own short "Heading:" line keeps that heading; nothing is invented for the others. */
export function sectionsOf(text: string): { heading?: string; body: string }[] {
  return paragraphsOf(text).map(p => {
    const m = /^([^\n.:]{2,40}):[ \t]*\n+([\s\S]+)$/.exec(p);
    return m ? { heading: m[1]!.trim(), body: m[2]!.trim() } : { body: p };
  });
}

/** "1 summary from your care team. Latest: your visit on 6 October." */
export const headerLead = (list: Summary[], locale: string) =>
  list[0] ? `${list.length} ${list.length === 1 ? "summary" : "summaries"} from your care team. Latest: your visit on ${new Date(list[0].at).toLocaleDateString(locale, { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "long" })}.` : "";

// ponytail: keyword match, English only; ask the API for structured instructions when summaries come in other languages.
const TO_DO = /\b(take|daily|more days|return|call|follow[- ]?up|home)\b/i;
const MEDICINE = /\b(medicines?|medications?|tablets?|capsules?|doses?|antibiotics?|inhalers?|mg|mcg)\b/i;

export type Insight = { lead: string; rows: string[]; medicine: boolean };

/** What the summary means for the patient, from its own words only: what changed, or else the sentences that give an instruction or a plan. Nothing to show: undefined. */
export function insightOf(s: Summary): Insight | undefined {
  const changed = s.whatChanged.length > 0;
  const rows = changed ? s.whatChanged : sentencesOf(s.text).filter(x => TO_DO.test(x)).slice(0, 3);
  if (!rows.length) return undefined;
  const n = rows.length;
  const lead = changed ? `${n} ${n === 1 ? "thing" : "things"} changed after this visit.` : `${n} ${n === 1 ? "line in this summary tells" : "lines in this summary tell"} you what happens next.`;
  return { lead, rows, medicine: rows.some(r => MEDICINE.test(r)) };
}

/** The summary a link names, or the newest when the link names none or one that is not this patient's. */
export const openOf = (list: Summary[], id?: string) => list.find(s => s.id === id) ?? list[0];
