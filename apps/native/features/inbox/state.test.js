import { expect, test } from "bun:test";
import { insight, lastLine, sampleInbox, sections, summary, waited } from "./state";

const now = "2026-09-26T04:00:00.000Z";
const row = (name, label, waitingSince, handled = false) => ({ patientId: name, name, label: handled ? null : label, waitingSince: handled ? null : waitingSince, handled });
const threads = [
  row("Amelia", "urgent", "2026-09-26T03:40:00.000Z"),
  row("Daniel", "clinical", "2026-09-26T02:00:00.000Z"),
  row("Farid", "clinical", "2026-09-26T03:00:00.000Z"),
  row("Mei", "admin", null, true),
];

test("the insight line says who is waiting, how many are urgent and the longest wait", () => {
  expect(insight(threads, now)).toBe("3 waiting · 1 urgent · longest 2 h");
  expect(insight(threads.slice(1), now)).toBe("2 waiting · longest 2 h");
  expect(insight([threads[3]], now)).toBe("All caught up");
  expect([waited("2026-09-26T03:59:40.000Z", now), waited("2026-09-26T03:48:00.000Z", now), waited("2026-09-23T04:00:00.000Z", now)]).toEqual(["just now", "12 min", "3 d"]);
});

test("sections are only the non-empty triage groups of waiting threads; one summary counts them for every entry point", () => {
  expect(sections(threads).map(s => [s.label, s.rows.map(r => r.name)])).toEqual([["urgent", ["Amelia"]], ["clinical", ["Daniel", "Farid"]]]);
  expect(summary(threads, now)).toEqual({ waiting: 3, urgent: 1, longest: "2 h", line: "1 urgent · 3 waiting" });
  expect(summary(threads.slice(1), now).line).toBe("2 waiting");
  expect(summary(undefined)).toEqual({ waiting: 0, urgent: 0, longest: undefined, line: "All caught up" });
});

test("demo mode's sample inbox has one waiting thread per triage, as the server's rules triage them", () => {
  const sample = sampleInbox(new Date(now));
  expect(sections(sample.threads).map(s => [s.label, s.rows.map(r => r.name)])).toEqual([["urgent", ["Amelia Tan"]], ["clinical", ["Daniel Rahman"]], ["admin", ["Nurul Huda"]]]);
  expect(insight(sample.threads, sample.now)).toBe("3 waiting · 1 urgent · longest 3 h");
  expect([sample.threads[0].reason, lastLine(sample.threads[1])]).toEqual(["Mentions “breathless”: possible emergency", "Photo · Cetirizine 10 mg"]);
});

test("a medicine photo's row says what was photographed instead of the message words", () => {
  expect(lastLine({ lastText: "Please check a medicine I added from a photo: Cetirizine 10 mg, once at night.", lastPhoto: "Cetirizine 10 mg" })).toBe("Photo · Cetirizine 10 mg");
  expect(lastLine({ lastText: "Thank you", lastPhoto: null })).toBe("Thank you");
});
