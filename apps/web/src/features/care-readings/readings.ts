import type { client } from "@/lib/orpc";

export type ReadingList = Awaited<ReturnType<typeof client.care.readings.list>>;
export type Series = ReadingList["series"][number];
export type Kind = Series["kind"];
export type NewReading = { kind: Kind; value: number; value2?: number; takenAt?: Date };

/** Labels and units as the server names them (`READING_KINDS` in the readings router), in its order. */
export const KINDS: Record<Kind, Pick<Series, "label" | "unit">> = {
  blood_pressure: { label: "Blood pressure", unit: "mmHg" },
  heart_rate: { label: "Heart rate", unit: "bpm" },
  temperature: { label: "Temperature", unit: "°C" },
  weight: { label: "Weight", unit: "kg" },
  blood_glucose: { label: "Blood glucose", unit: "mmol/L" },
  oxygen_saturation: { label: "Oxygen saturation", unit: "%" },
};
export const KIND_ORDER = Object.keys(KINDS) as Kind[];

const number = (text: string) => {
  const t = text.trim().replace(",", ".");
  return t === "" ? NaN : Number(t);
};

/** What the patient typed, as the server's input. Only "is it a number" is checked here: the server judges the range. */
export function parseReading(kind: Kind, text: string, text2: string, time: string): { input: NewReading } | { error: string } {
  const value = number(text), bp = kind === "blood_pressure", value2 = bp ? number(text2) : undefined;
  if (Number.isNaN(value) || (bp && Number.isNaN(value2))) return { error: bp ? "Type both numbers, the upper one first, like 120 and 80." : "Type the number from your device." };
  const takenAt = time ? new Date(time) : undefined;
  if (takenAt && Number.isNaN(takenAt.getTime())) return { error: "That time doesn't look right." };
  return { input: { kind, value, ...(bp ? { value2 } : {}), ...(takenAt ? { takenAt } : {}) } };
}

/** The list with one more reading in its place by time: shown at once, before the server answers. */
export function withReading(list: ReadingList, r: NewReading, id: string, now: Date): ReadingList {
  const point = { id, at: r.takenAt ?? now, value: r.value, ...(r.kind === "blood_pressure" ? { value2: r.value2 } : {}) };
  const add = (s: Series): Series => ({ ...s, points: [...s.points, point].sort((a, b) => +new Date(a.at) - +new Date(b.at)) });
  const series = list.series.some(s => s.kind === r.kind)
    ? list.series.map(s => (s.kind === r.kind ? add(s) : s))
    : [...list.series, add({ kind: r.kind, ...KINDS[r.kind], points: [] })].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return { ...list, series };
}

/** "120/80 mmHg", "36.8 °C". */
export const valueWords = (s: Pick<Series, "unit">, p: Series["points"][number]) => `${p.value}${p.value2 != null ? `/${p.value2}` : ""} ${s.unit}`;

/** Only the points at or after `since`; a kind with none left is dropped. */
export const since = (series: Series[], from: number) =>
  series.map(s => ({ ...s, points: s.points.filter(p => +new Date(p.at) >= from) })).filter(s => s.points.length);
