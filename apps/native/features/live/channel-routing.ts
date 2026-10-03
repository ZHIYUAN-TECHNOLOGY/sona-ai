import type { Change } from "@sona-ai/api/events";

/** What a screen may need to re-read; "visit" is filtered by encounter where it is used. */
export type Reread = "visit" | "ward" | "day" | "checkIns" | "findings" | "handover" | "messages" | "library" | "training";
const ALL: Reread[] = ["visit", "ward", "day", "checkIns", "findings", "handover", "messages", "library", "training"];

// Which parts of the app each API topic touches (a discharge also writes tasks and schedules check-ins).
const BY_TOPIC: Record<string, Reread[]> = {
  claim: ["visit", "ward"],
  discharge: ["visit", "ward", "day", "checkIns"],
  encounter: ["visit"], prescribing: ["visit"], note: ["visit"], xray: ["visit"],
  // A visit changed outside its own routes, announced by name (a medicine from a Sona Care photo added); a scanned note also adds follow-up tasks.
  visit: ["visit"], scan: ["visit", "day"],
  results: ["day"], tasks: ["day"], audit: ["day"],
  ward: ["ward", "day"],
  checkIns: ["day", "checkIns"],
  findings: ["ward", "day", "findings"],
  handover: ["handover"], library: ["library"], training: ["training"],
  // Sona Care: a patient's message is a task on My Day; either side's message re-reads the thread.
  messages: ["day", "messages"],
  // Sona Care: a dose marked taken changes what My Day's flagged rows say was missed.
  doses: ["day"],
  // Sona Care: a booking request (or a colleague's decision on one) is a row on My Day.
  bookings: ["day"],
  // The demo clock moved: everything time-based may have changed.
  demo: ALL,
};

/** A change re-reads only what it touches; "resync" (after a reconnect) re-reads everything, since changes may have been missed. */
export function rereads(change: Change | "resync"): Reread[] {
  return change === "resync" ? ALL : BY_TOPIC[change.topic] ?? [];
}
