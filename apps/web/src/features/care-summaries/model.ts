/** An approved after-visit summary, as `care.visitSummaries.list` returns it. */
export type Summary = { id: string; at: Date | string; text: string; whatChanged: string[] };

const sentencesOf = (text: string) => text.split(/(?<=[.!?。！？])\s+/).map(s => s.trim()).filter(Boolean);

export const firstSentence = (text: string) => sentencesOf(text)[0] ?? "";

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

/** The one thing to read: how much changed and when, then the summary's first sentence. */
export function leadOf(s: Summary, locale: string): string {
  const n = s.whatChanged.length, on = dateOf(s.at, locale);
  const count = n === 0 ? `Your summary from your visit on ${on} is ready.` : `${n} ${n === 1 ? "thing" : "things"} changed after your visit on ${on}.`;
  return [count, firstSentence(s.text)].filter(Boolean).join(" ");
}

/** The summary a link names, or the newest when the link names none or one that is not this patient's. */
export const openOf = (list: Summary[], id?: string) => list.find(s => s.id === id) ?? list[0];

/** "No changes", "1 change", "3 changes". */
export const changesLabel = (n: number) => (n === 0 ? "No changes" : n === 1 ? "1 change" : `${n} changes`);
