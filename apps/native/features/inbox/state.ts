import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { palette } from "@/components/sona/theme";

/** The care inbox's words and ordering, kept pure so they are tested without a phone. */
export type Inbox = Awaited<ReturnType<AppRouterClient["messages"]["inbox"]>>;
export type InboxThread = Inbox["threads"][number];
export type Label = NonNullable<InboxThread["label"]>;
export const LABELS: Label[] = ["urgent", "clinical", "admin"];

/** Colour carries the triage: red must-not-miss, blue a clinician's question, grey admin. */
export const LABEL_STYLE: Record<Label, { text: string; ink: string; wash: string }> = {
  urgent: { text: "Urgent", ink: palette.red, wash: "rgba(162,62,62,0.10)" },
  clinical: { text: "Clinical", ink: palette.blue, wash: "rgba(36,91,204,0.09)" },
  admin: { text: "Admin", ink: palette.muted, wash: "rgba(20,28,40,0.06)" },
};

/** "just now", "12 min", "2 h", "3 d": how long someone has waited, by the server's (demo) clock. */
export function waited(since: Date | string, now: Date | string) {
  const mins = Math.max(0, Math.round((new Date(now).getTime() - new Date(since).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h`;
  return `${Math.floor(mins / (24 * 60))} d`;
}

/** "12:04" in Malaysia, where the demo hospital is. */
export const clock = (at: Date | string) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });

/** Insight first: "3 waiting · 1 urgent · longest 2 h", or that nobody is waiting. */
export function insight(threads: InboxThread[], now: Date | string) {
  const open = threads.filter(t => !t.handled);
  if (!open.length) return "All caught up";
  const urgent = open.filter(t => t.label === "urgent").length;
  const oldest = open.reduce<Date | undefined>((min, t) => t.waitingSince && (!min || new Date(t.waitingSince) < min) ? new Date(t.waitingSince) : min, undefined);
  return [`${open.length} waiting`, urgent ? `${urgent} urgent` : "", oldest ? `longest ${waited(oldest, now)}` : ""].filter(Boolean).join(" · ");
}

/** Waiting threads by triage, only the sections that have any (the server already ranks within each). */
export const sections = (threads: InboxThread[]) =>
  LABELS.map(label => ({ label, rows: threads.filter(t => !t.handled && t.label === label) })).filter(s => s.rows.length);

/** The top bar's badge: threads waiting, red when any is urgent. */
export function badge(threads: InboxThread[] | undefined) {
  const open = threads?.filter(t => !t.handled) ?? [];
  return { count: open.length, urgent: open.some(t => t.label === "urgent") };
}
