import { can, type Role } from "@sona-ai/api/roles";
import type { IconName } from "@/components/icon";

export type NavItem = { to: string; label: string; icon: IconName; /** Shown as a small badge when above zero. */ count?: number; /** Route in the permission table that the page needs; the entry hides without it. */ needs?: string };
export type NavGroup = { label: string; items: NavItem[] };

/** Sona Pro's sidebar, grouped by kind of work. */
export const PRO_NAV: NavGroup[] = [
  { label: "My day", items: [
    { to: "/pro/today", icon: "today", label: "Today", needs: "day.list" },
    { to: "/pro/schedule", icon: "calendar", label: "Schedule", needs: "bookings.slots" },
    { to: "/pro/tasks", icon: "tasks", label: "Tasks", needs: "tasks.list" },
  ] },
  { label: "Patients", items: [
    { to: "/pro/patients", icon: "users", label: "Patients", needs: "patients.list" },
    { to: "/pro/visit", icon: "clipboard", label: "Visit", needs: "encounter.get" },
    { to: "/pro/results", icon: "flask", label: "Results", needs: "results.list" },
    { to: "/pro/xray", icon: "scan", label: "X-ray", needs: "xray.read" },
  ] },
  { label: "Inbox", items: [
    { to: "/pro/messages", icon: "message", label: "Messages", needs: "messages.list" },
    { to: "/pro/review", icon: "inbox", label: "Review queue", needs: "messages.list" },
  ] },
  { label: "Ward", items: [
    { to: "/pro/ward", icon: "bed", label: "Ward", needs: "ward.beds" },
    { to: "/pro/handover", icon: "swap", label: "Handover", needs: "handover.list" },
    { to: "/pro/discharge", icon: "sign-out", label: "Discharge", needs: "discharge.plan" },
  ] },
  { label: "Hospital", items: [
    { to: "/pro/guarantee-letter", icon: "file", label: "Guarantee letter", needs: "claim.status" },
    { to: "/pro/audit", icon: "shield-check", label: "Audit", needs: "accessLog.list" },
    { to: "/pro/library", icon: "book", label: "Library", needs: "library.list" },
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

/** The groups a role may open; a group with nothing left is dropped. */
export const navFor = (role: Role, groups: NavGroup[] = PRO_NAV): NavGroup[] =>
  groups.map(group => ({ ...group, items: group.items.filter(item => !item.needs || can(role, item.needs)) })).filter(group => group.items.length > 0);
