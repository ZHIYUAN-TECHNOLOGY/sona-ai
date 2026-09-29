import type { T } from "@/lib/i18n";

/**
 * A medicine the patient added from a photo: what was read (and corrected by them), sent to the care
 * team to check. It shows in their medicines as waiting, never as confirmed, and has no dose timer.
 */
export type PhotoMedicine = { id: string; name: string; dose?: string; how?: string; key?: string; sentAt: string };
export type PhotoReading = Pick<PhotoMedicine, "name" | "dose" | "how">;

/** "Cetirizine 10 mg, once at night". */
export const medLine = (m: PhotoReading) => [[m.name, m.dose].filter(Boolean).join(" "), m.how].filter(Boolean).join(", ");

/** The care message's words; the photo and the reading travel with it as its attachment. */
export const messageFor = (m: PhotoReading, t: T) => t("photo.message", { med: medLine(m) });

/** Where the care team's decision stands, from the thread (the message's ID ends with this medicine's request ID). */
export type PhotoStatus = "waiting" | "added" | "declined";
type Sent = { id: string; attachment?: { decision?: { status: "added" | "declined" } } | null };
export const statusOf = (m: Pick<PhotoMedicine, "id">, thread: Sent[] | undefined): PhotoStatus =>
  thread?.find(x => x.id.endsWith(`:${m.id}`))?.attachment?.decision?.status ?? "waiting";

/** Adds the sent medicine to the waiting list, newest last; the same name again replaces the older one. */
export function addWaiting(list: PhotoMedicine[], m: PhotoMedicine) {
  return [...list.filter(x => x.name.toLowerCase() !== m.name.toLowerCase()), m].slice(-20);
}

/**
 * The photo medicines not already in the discharge plan: one the plan lists shows once, as the plan's.
 * ponytail: matches on the first word (the ingredient, "Cetirizine 10 mg" → "cetirizine"); use a drug code once readings carry one.
 */
const ingredient = (name: string) => name.trim().split(/\s+/)[0]!.toLowerCase();
export const unplanned = <T extends Pick<PhotoMedicine, "name">>(list: T[], planned: string[]) =>
  list.filter(m => !planned.some(n => ingredient(n) === ingredient(m.name)));
