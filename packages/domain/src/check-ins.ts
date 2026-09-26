import type { Language } from "./discharge";

/**
 * Demo flow 7, after-discharge check-ins (docs/research/ops-demo-flows.md). Messages go out on day 2
 * and day 7 in the leaflet's language through a simulated inbox; no real patient is contacted.
 */
export const CHECK_IN_DAYS = [2, 7] as const;
export type CheckInDay = (typeof CHECK_IN_DAYS)[number];
/** How a reply was read: worse or urgent replies become a flagged task on the doctor's day. */
export type ReplyLabel = "fine" | "worse" | "urgent";
export type CheckInLanguage = Language;
