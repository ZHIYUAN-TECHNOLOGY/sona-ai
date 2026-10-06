export type IcsVisit = { id: string; title: string; start: Date; minutes?: number; location?: string; description?: string };

const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/[,;]/g, "\\$&").replace(/\r?\n/g, "\\n");

/** One visit as an iCalendar file (RFC 5545): UTC times, CRLF lines, escaped text. `now` is the DTSTAMP. */
export function visitIcs(v: IcsVisit, now: Date): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sona Care//Follow-ups//EN",
    "BEGIN:VEVENT",
    `UID:${text(v.id)}@sona-care`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(v.start)}`,
    `DTEND:${stamp(new Date(v.start.getTime() + (v.minutes ?? 30) * 60_000))}`,
    `SUMMARY:${text(v.title)}`,
    ...(v.location ? [`LOCATION:${text(v.location)}`] : []),
    ...(v.description ? [`DESCRIPTION:${text(v.description)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** Hands the visit to the browser as a download. */
export function downloadIcs(v: IcsVisit, now: Date) {
  const url = URL.createObjectURL(new Blob([visitIcs(v, now)], { type: "text/calendar" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "visit.ics" });
  a.click();
  URL.revokeObjectURL(url);
}
