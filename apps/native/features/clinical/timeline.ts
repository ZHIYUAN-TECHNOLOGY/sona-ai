/**
 * When a recorded event happened, as the briefing's timeline says it beside the event: the time for today, "Yesterday"
 * and "Tomorrow" with the time, else the date. `now` is the hospital's (demo) clock. Pure, so it is tested without the app.
 */
export function timelineLabel(at: Date | string, now: Date): string {
  const when = new Date(at), day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(when) - day(now)) / 86_400_000);
  const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return days === 0 ? time : days === -1 ? `Yesterday ${time}` : days === 1 ? `Tomorrow ${time}` : when.toLocaleDateString([], { day: "numeric", month: "short" });
}
