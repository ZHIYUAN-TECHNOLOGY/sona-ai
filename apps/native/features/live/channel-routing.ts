import type { Change } from "@sona-ai/api/events";

/** What a screen may need to re-read; "visit" is filtered by encounter where it is used. */
export type Reread = "visit" | "ward" | "day" | "checkIns" | "findings" | "handover";
const ALL: Reread[] = ["visit", "ward", "day", "checkIns", "findings", "handover"];

// Which parts of the app each API topic touches (a discharge also writes tasks and schedules check-ins).
const BY_TOPIC: Record<string, Reread[]> = {
  claim: ["visit", "ward"],
  discharge: ["visit", "ward", "day", "checkIns"],
  encounter: ["visit"], prescribing: ["visit"], note: ["visit"], xray: ["visit"],
  results: ["day"], tasks: ["day"], audit: ["day"],
  ward: ["ward", "day"],
  checkIns: ["day", "checkIns"],
  findings: ["ward", "day", "findings"],
  handover: ["handover"],
};

/** A change re-reads only what it touches; "resync" (after a reconnect) re-reads everything, since changes may have been missed. */
export function rereads(change: Change | "resync"): Reread[] {
  return change === "resync" ? ALL : BY_TOPIC[change.topic] ?? [];
}
