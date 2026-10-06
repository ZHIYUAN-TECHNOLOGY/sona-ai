import type { Point } from "@/components/chart-scale";

export type Released = { id: string; test: string; at: Date | string; released: true; value: string; unit?: string; flag?: string };
export type Waiting = { id: string; test: string; at: Date | string; released: false };
export type Result = Released | Waiting;

export const REVIEWING = "Your care team is reviewing this. You will see it here once they have.";

/** A day in the hospital's time zone, so every patient and the ward read the same date. */
export const dateOf = (at: Date | string, lang = "en"): string =>
  new Date(at).toLocaleDateString(lang === "zh" ? "zh-CN" : lang === "ms" ? "ms" : "en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" });

export const valueOf = (r: Released): string => (r.unit ? `${r.value} ${r.unit}` : r.value);

/** Only a plain number counts ("5.2", not "<5", "5-6" or "Positive"): the chart never guesses a point. */
export const numberOf = (value: string): number | undefined =>
  /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : undefined;

// ponytail: any flag other than "normal" counts as flagged; the flag is free text in the database.
export const isFlagged = (flag: string | undefined): boolean => !!flag && flag.toLowerCase() !== "normal";

/** The one line at the top. `results` is newest first, as the server sends it. */
export function leadOf(results: Result[], lang = "en"): { text: string; tone: "info" | "soon"; openId?: string } | undefined {
  const newest = results[0];
  if (!newest) return undefined;
  if (!newest.released) return { text: "Your care team is reviewing a new result.", tone: "soon" };
  return {
    text: `Your newest result: ${newest.test} was ${valueOf(newest)} on ${dateOf(newest.at, lang)}.`,
    tone: isFlagged(newest.flag) ? "soon" : "info",
    openId: newest.id,
  };
}

/** The released, plain-number results of one test, oldest first. Fewer than two is not a trend. */
export function trendOf(results: Result[], test: string, lang = "en"): Point[] {
  const points = results.flatMap((r) => {
    const y = r.released && r.test === test ? numberOf(r.value) : undefined;
    return y === undefined ? [] : [{ x: dateOf(r.at, lang), y }];
  }).reverse();
  return points.length >= 2 ? points : [];
}
