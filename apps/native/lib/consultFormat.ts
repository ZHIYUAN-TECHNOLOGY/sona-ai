import type { Consult, ConsultStatus } from "./db/types";

/** Initials for a consult list avatar, from its (non-PII) title. */
export function consultInitials(title: string): string {
  const parts = title.trim().split(/\s+/).slice(0, 2);
  const s = parts.map((w) => w[0]?.toUpperCase() ?? "").join("");
  return s || "C";
}

/** Card headline: patient name when captured, else the consult title. */
export function consultHeadline(c: Consult): string {
  return c.patientName || c.title;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "8:32 PM" today, "12 Jul · 8:32 PM" for older consults — a bare clock time is
 *  meaningless a week later. */
export function consultDateTime(ms: number): string {
  if (isToday(ms)) return consultTime(ms);
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${consultTime(ms)}`;
}

/**
 * Card detail line: date/time, plus the consult title (visit reason) when the
 * headline is the patient name. Patient context (room / visit type / phone) renders
 * as icon chips via consultChips — not crammed into this line.
 */
export function consultSubtitle(c: Consult): string {
  const parts: string[] = [consultDateTime(c.createdAt)];
  if (c.patientName) parts.push(c.title);
  return parts.join(" · ");
}

/** One-line everything variant for the consult detail header (no chips up there). */
export function consultFullSubtitle(c: Consult): string {
  return [consultSubtitle(c), ...consultChips(c).map((chip) => chip.label)].join(" · ");
}

/**
 * Scannable patient-context chips for the consult card — the details a clinician
 * hunts for when finding a session (room, walk-in vs appointment, phone). Absent
 * fields are skipped; pre-patient-details consults get no chips.
 */
export function consultChips(
  c: Consult,
): { icon: "location-outline" | "walk-outline" | "calendar-outline" | "call-outline"; label: string }[] {
  const chips: ReturnType<typeof consultChips> = [];
  if (c.room) chips.push({ icon: "location-outline", label: c.room });
  if (c.visitType === "walk-in") chips.push({ icon: "walk-outline", label: "Walk-in" });
  if (c.visitType === "appointment") chips.push({ icon: "calendar-outline", label: "Appointment" });
  if (c.patientPhone) chips.push({ icon: "call-outline", label: c.patientPhone });
  return chips;
}

/** "9:41 AM" style clock label from epoch millis. */
export function consultTime(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

/** A short day bucket for grouping ("Today" / "Earlier"). */
export function isToday(ms: number): boolean {
  const d = new Date(ms);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export function statusMeta(status: ConsultStatus): {
  label: string;
  variant: "green" | "amber" | "line";
} {
  switch (status) {
    case "signed":
    case "complete":
      return { label: "Signed", variant: "green" };
    case "noted":
      return { label: "Note ready", variant: "amber" };
    default:
      return { label: "Draft", variant: "line" };
  }
}
