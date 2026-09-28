import { expect, test } from "bun:test";
import { can, needs } from "@sona-ai/api/roles";
import { ago, trailLine } from "./access";

test("trail times read relative to the server's clock, and a line says who, what and when", () => {
  const now = "2026-09-26T02:30:00Z";
  expect(["2026-09-26T02:29:40Z", "2026-09-26T02:18:00Z", "2026-09-25T23:30:00Z", "2026-09-24T02:30:00Z"].map(at => ago(at, now))).toEqual(["just now", "12 min ago", "3 h ago", "2 d ago"]);
  expect(trailLine({ who: "Dr Test Aisyah", did: "opened the note", at: "2026-09-26T02:02:00Z", times: 1 })).toBe("Dr Test Aisyah · opened the note · 10:02");
  expect(trailLine({ who: "Nurse Test Mei Ling", did: "opened the visit", at: "2026-09-26T02:02:00Z", times: 3 })).toBe("Nurse Test Mei Ling · opened the visit (3 times) · 10:02");
});

test("the app reads the same permission table the server enforces", () => {
  expect(can("nurse", "discharge.request")).toBe(false);
  expect(can("doctor", "discharge.request")).toBe(true);
  expect(can("management", "accessLog.list")).toBe(true);
  expect(needs("claim.send")).toBe("Needs a doctor");
});
