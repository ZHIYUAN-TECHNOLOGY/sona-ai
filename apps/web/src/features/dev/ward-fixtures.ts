import type { Bed } from "@sona-ai/domain/ward";

/**
 * Dev-only data for the Ward table (`?data=worst|empty|one|many`): realistic worst cases entered where the API's beds
 * would be, to see what the table does with data the seed never has. Never read outside the dev build.
 */
const b = (bed: string, extra: Partial<Bed>): Bed => ({ bed, status: "stable", predicted: "", blockers: [], ...extra });
const x = (id: string, label: string, kind: Bed["blockers"][number]["kind"] = "gl") => ({ id, kind, label, detail: "" });

export const WORST_BEDS: Bed[] = [
  b("Bed 12A (Isolation, side room)", { name: "Aleksandra Wiśniewska-Kowalczyk", meta: "84 · Female", status: "fit", predicted: "Awaiting nursing home placement (Rumah Seri Kenangan, Cheras)",
    blockers: [x("w1", "Final guarantee letter"), x("w2", "Urine culture sensitivities", "result"), x("w3", "Take-home medicines", "pharmacy"), x("w4", "Ride home", "transport"), x("w5", "Follow-up booking", "booking")] }),
  b("Bed 3", { name: "Jo", meta: "19 · Male", status: "watch", predicted: "Tomorrow" }),
  b("Bed 7", { name: "Christopher Alexander Montgomery III", meta: "101 · Male", status: "fit", predicted: "11:00", blockers: [x("w6", "Repeat haemoglobin and iron studies before transfusion decision", "result")] }),
  b("Bed 8", { name: "نور الهدى عبد الرحمن", meta: "45 · Female", status: "stable", predicted: "In 2 days" }),
  b("Bed 9", { name: "王秀英", meta: "67 · Female", status: "fit", predicted: "", blockers: [x("w7", "Ride home", "transport")] }),
  b("Bed 10", { name: "Đặng Thị Ngọc Hân", meta: "33 · Female", status: "watch", predicted: "Once cleared", blockers: [x("w8", "Benachrichtigungseinstellungen", "booking")] }),
  b("Bed 11", { name: "🦊 Fox", meta: "", status: "stable", predicted: "Tomorrow" }),
  b("Bed 14", { status: "free", predicted: "" }),
];

export const ONE_BED: Bed[] = [b("Bed 1", { name: "Siti Aminah", meta: "68 · Female", status: "fit", predicted: "11:00", blockers: [x("o1", "Ride home", "transport")] })];

export const MANY_BEDS: Bed[] = Array.from({ length: 1200 }, (_, i) => b(`Bed ${i + 1}`, { name: `Patient ${i + 1}`, meta: `${20 + (i % 70)} · ${i % 2 ? "Male" : "Female"}`,
  status: (["fit", "watch", "stable"] as const)[i % 3], predicted: i % 4 ? "Tomorrow" : "11:00", blockers: i % 5 ? [] : [x(`m${i}`, "Final guarantee letter")] }));

export function devBeds(): Bed[] | undefined {
  if (!import.meta.env.DEV) return undefined;
  const data = new URLSearchParams(window.location.search).get("data");
  return data === "worst" ? WORST_BEDS : data === "empty" ? [] : data === "one" ? ONE_BED : data === "many" ? MANY_BEDS : undefined;
}
