import { PERMISSIONS, ROLES, type Role } from "@sona-ai/api/roles";

export type Area = { area: string; can: string[]; cannot: string[] };

/** "checkIns" reads "Check ins". */
const areaName = (path: string) => {
  const words = path.split(".")[0]!.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * What a role can and cannot do, by area, in the server's own words. Only the rules that differ between
 * roles are listed: what everyone may do says nothing about this role.
 */
export function roleAreas(role: Role, rules: typeof PERMISSIONS = PERMISSIONS): Area[] {
  const areas = new Map<string, Area>();
  for (const [path, [roles, phrase]] of Object.entries(rules)) {
    if (roles.length >= ROLES.length) continue;
    const name = areaName(path);
    const area = areas.get(name) ?? { area: name, can: [], cannot: [] };
    (roles.includes(role) ? area.can : area.cannot).push(phrase);
    areas.set(name, area);
  }
  return [...areas.values()];
}

const DAY = 86_400_000;
const KL = 8 * 3_600_000;
const klDay = (at: Date) => Math.floor((at.getTime() + KL) / DAY);

/** Calendar days since discharge in Kuala Lumpur (the discharge day is day 0), as the phone apps count them. */
export const daysAfter = (dischargedAt: Date, now: Date) => klDay(now) - klDay(dischargedAt);

const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/** The hospital's time (Kuala Lumpur), such as "Wed 30 Sept, 10:02". */
export const hospitalTime = (at: Date) => TIME.format(at);

/** How far the demo clock is from real time, in plain words: "2 days ahead of real time". */
export function offsetText(ms: number) {
  const hours = Math.round(Math.abs(ms) / 3_600_000);
  if (!hours) return "on real time";
  const [n, unit] = hours >= 24 ? [Math.round(hours / 24), "day"] : [hours, "hour"];
  return `${n} ${unit}${n === 1 ? "" : "s"} ${ms > 0 ? "ahead of" : "behind"} real time`;
}

export const hourLabel =(hour: number) => `${String(hour).padStart(2, "0")}:00`;
