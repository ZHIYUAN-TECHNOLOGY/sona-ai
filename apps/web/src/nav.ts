import { can, type Role } from "@sona-ai/api/roles";
import type { IconName } from "@/components/icon";

/**
 * `needs` is the route in the permission table that the page's own job needs (not merely one the page can read), so
 * a role is never shown a page it can open but not use; a list means any one of them is enough. The entry hides without it.
 */
export type NavItem = { to: string; label: string; icon: IconName; /** Shown as a small badge when above zero. */ count?: number; needs?: string | string[] };
export type NavGroup = { label: string; items: NavItem[] };

/** Sona Pro's sidebar, grouped by kind of work. */
export const PRO_NAV: NavGroup[] = [
  { label: "My day", items: [
    // The day's and week's visits are for whoever may open a visit: a bed manager's day is the ward.
    { to: "/pro/today", icon: "today", label: "Today", needs: "encounter.get" },
    { to: "/pro/schedule", icon: "calendar", label: "Schedule", needs: "encounter.get" },
    { to: "/pro/tasks", icon: "tasks", label: "Tasks", needs: "tasks.list" },
  ] },
  { label: "Patients", items: [
    // Every row opens the patient's record, which is clinical detail.
    { to: "/pro/patients", icon: "users", label: "Patients", needs: "patients.trends" },
    { to: "/pro/visit", icon: "clipboard", label: "Visit", needs: "encounter.get" },
    { to: "/pro/results", icon: "flask", label: "Results", needs: "results.list" },
    { to: "/pro/xray", icon: "scan", label: "X-ray", needs: "xray.read" },
    { to: "/pro/evidence", icon: "sparkle", label: "Evidence", needs: "evidence.ask" },
  ] },
  { label: "Inbox", items: [
    { to: "/pro/messages", icon: "message", label: "Messages", needs: "messages.list" },
    { to: "/pro/review", icon: "inbox", label: "Review queue", needs: "review.list" },
  ] },
  { label: "Ward", items: [
    { to: "/pro/ward", icon: "bed", label: "Ward", needs: "ward.beds" },
    { to: "/pro/handover", icon: "swap", label: "Handover", needs: "handover.list" },
    { to: "/pro/check-ins", icon: "check", label: "Check-ins", needs: "checkIns.list" },
    { to: "/pro/discharge", icon: "sign-out", label: "Discharge", needs: "discharge.plan" },
  ] },
  { label: "Hospital", items: [
    // The letter is its codes: without them there is nothing to check, send or appeal.
    { to: "/pro/guarantee-letter", icon: "file", label: "Guarantee letter", needs: "claim.suggestCodes" },
    { to: "/pro/audit", icon: "shield-check", label: "Audit", needs: "accessLog.list" },
    // For whoever adds sources or asks Sona for evidence from them.
    { to: "/pro/library", icon: "book", label: "Library", needs: ["library.add", "evidence.ask"] },
    { to: "/pro/training-data", icon: "database", label: "Training data", needs: "training.status" },
  ] },
  { label: "Account", items: [{ to: "/pro/settings", icon: "settings", label: "Settings" }] },
];

/** Sona Care's sidebar: every patient sees all of it. */
export const CARE_NAV: NavGroup[] = [
  { label: "My care", items: [
    { to: "/care/home", icon: "home", label: "Home" },
    { to: "/care/follow-ups", icon: "calendar", label: "Follow-ups" },
    { to: "/care/visit-summaries", icon: "file", label: "Visit summaries" },
    { to: "/care/health-summary", icon: "user", label: "Health summary" },
    { to: "/care/medicines", icon: "pill", label: "Medicines" },
    { to: "/care/results", icon: "flask", label: "Results" },
    { to: "/care/readings", icon: "activity", label: "Readings" },
    { to: "/care/discharge-plan", icon: "clipboard", label: "Discharge plan" },
    { to: "/care/check-ins", icon: "check", label: "Check-ins" },
  ] },
  { label: "My team", items: [
    { to: "/care/care-team", icon: "users", label: "Care team" },
    { to: "/care/messages", icon: "message", label: "Messages" },
    { to: "/care/ask", icon: "sparkle", label: "Ask Sona" },
  ] },
];

/** Whether a role may open a page: any one of its `needs`, or no `needs` at all. */
export const opens = (role: Role, item: NavItem) => !item.needs || [item.needs].flat().some(path => can(role, path));

/** The groups a role may open; a group with nothing left is dropped. */
export const navFor = (role: Role, groups: NavGroup[] = PRO_NAV): NavGroup[] =>
  groups.map(group => ({ ...group, items: group.items.filter(item => opens(role, item)) })).filter(group => group.items.length > 0);

/** Where a role lands after signing in: Today, or the ward for a role whose day is beds, not visits. */
export const homeFor = (role: Role) => (can(role, "encounter.get") ? "/pro/today" : "/pro/ward");
