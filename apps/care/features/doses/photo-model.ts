import type { T } from "@/lib/i18n";

/**
 * A medicine the patient added from a photo: what was read (and corrected by them), sent to the care
 * team to check. It shows in their medicines as waiting, never as confirmed, and has no dose timer.
 */
export type PhotoMedicine = { id: string; name: string; dose?: string; how?: string; key?: string; sentAt: string };
export type PhotoReading = Pick<PhotoMedicine, "name" | "dose" | "how">;

/** "Cetirizine 10 mg, once at night". */
export const medLine = (m: PhotoReading) => [[m.name, m.dose].filter(Boolean).join(" "), m.how].filter(Boolean).join(", ");

/** The care message: what they read, and where the photo is (its storage key, or that it stayed on the phone). */
export const messageFor = (m: PhotoReading & { key?: string }, t: T) => t("photo.message", { med: medLine(m), ref: m.key ?? t("photo.onPhone") });

/** Adds the sent medicine to the waiting list, newest last; the same name again replaces the older one. */
export function addWaiting(list: PhotoMedicine[], m: PhotoMedicine) {
  return [...list.filter(x => x.name.toLowerCase() !== m.name.toLowerCase()), m].slice(-20);
}
