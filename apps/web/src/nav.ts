import { can, type Role } from "@sona-ai/api/roles";

export type NavItem = { to: string; label: string; /** Route in the permission table that the page needs; the entry hides without it. */ needs?: string };
export type NavGroup = { label: string; items: NavItem[] };

/** Sona Pro's sidebar, grouped by kind of work. */
export const PRO_NAV: NavGroup[] = [
  { label: "My day", items: [
    { to: "/pro/today", label: "Today", needs: "day.list" },
    { to: "/pro/schedule", label: "Schedule", needs: "bookings.slots" },
    { to: "/pro/tasks", label: "Tasks", needs: "tasks.list" },
  ] },
  { label: "Patients", items: [
    { to: "/pro/patients", label: "Patients", needs: "patients.list" },
    { to: "/pro/visit", label: "Visit", needs: "encounter.get" },
    { to: "/pro/results", label: "Results", needs: "results.list" },
    { to: "/pro/xray", label: "X-ray", needs: "xray.read" },
  ] },
  { label: "Inbox", items: [
    { to: "/pro/messages", label: "Messages", needs: "messages.list" },
    { to: "/pro/review", label: "Review queue", needs: "messages.list" },
  ] },
  { label: "Ward", items: [
    { to: "/pro/ward", label: "Ward", needs: "ward.beds" },
    { to: "/pro/handover", label: "Handover", needs: "handover.list" },
    { to: "/pro/discharge", label: "Discharge", needs: "discharge.plan" },
  ] },
  { label: "Hospital", items: [
    { to: "/pro/guarantee-letter", label: "Guarantee letter", needs: "claim.status" },
    { to: "/pro/audit", label: "Audit", needs: "accessLog.list" },
    { to: "/pro/library", label: "Library", needs: "library.list" },
    { to: "/pro/training-data", label: "Training data", needs: "training.status" },
  ] },
  { label: "Account", items: [{ to: "/pro/settings", label: "Settings" }] },
];

/** Sona Care's sidebar: every patient sees all of it. */
export const CARE_NAV: NavGroup[] = [
  { label: "My care", items: [
    { to: "/care/home", label: "Home" },
    { to: "/care/follow-ups", label: "Follow-ups" },
    { to: "/care/visit-summaries", label: "Visit summaries" },
    { to: "/care/medicines", label: "Medicines" },
    { to: "/care/results", label: "Results" },
    { to: "/care/readings", label: "Readings" },
    { to: "/care/discharge-plan", label: "Discharge plan" },
    { to: "/care/check-ins", label: "Check-ins" },
  ] },
  { label: "My team", items: [
    { to: "/care/care-team", label: "Care team" },
    { to: "/care/messages", label: "Messages" },
    { to: "/care/ask", label: "Ask Sona" },
  ] },
];

/** The groups a role may open; a group with nothing left is dropped. */
export const navFor = (role: Role, groups: NavGroup[] = PRO_NAV): NavGroup[] =>
  groups.map(group => ({ ...group, items: group.items.filter(item => !item.needs || can(role, item.needs)) })).filter(group => group.items.length > 0);
