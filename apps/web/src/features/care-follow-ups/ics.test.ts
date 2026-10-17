// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { visitIcs } from "./ics";

test("visitIcs writes one escaped UTC event with CRLF lines", () => {
  const ics = visitIcs(
    { id: "visit:1", title: "Visit: Dr. Lim, Respiratory", start: new Date("2026-10-08T02:30:00Z"), location: "Clinic 3; Level 2" },
    new Date("2026-10-06T00:00:00Z"),
  );
  expect(ics.split("\r\n")).toEqual([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sona Care//Follow-ups//EN",
    "BEGIN:VEVENT",
    "UID:visit:1@sona-care",
    "DTSTAMP:20261006T000000Z",
    "DTSTART:20261008T023000Z",
    "DTEND:20261008T030000Z",
    "SUMMARY:Visit: Dr. Lim\\, Respiratory",
    "LOCATION:Clinic 3\\; Level 2",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]);
});
