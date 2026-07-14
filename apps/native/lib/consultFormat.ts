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

/**
 * Card detail line: time plus whatever patient context exists —
 * "9:41 AM · Room 3 · Walk-in · 012-345 6789". Fields are optional; absent ones
 * are simply skipped. When the headline is the patient name, the consult title
 * leads so the visit reason stays visible.
 */
export function consultSubtitle(c: Consult): string {
  const parts: string[] = [consultTime(c.createdAt)];
  if (c.patientName) parts.push(c.title);
  if (c.room) parts.push(c.room);
  if (c.visitType) parts.push(c.visitType === "walk-in" ? "Walk-in" : "Appointment");
  if (c.patientPhone) parts.push(c.patientPhone);
  return parts.join(" · ");
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
