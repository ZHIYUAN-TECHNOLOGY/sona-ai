import type { AppRouterClient } from "@sona-ai/api/routers/index";

export type Plan = Awaited<ReturnType<AppRouterClient["care"]["discharge"]>>;
export type Discharged = Extract<Plan, { status: "discharged" }>;

/** Home's one line for the plan: medicines to take home (stopped ones aside), what is new, the leaflet's language. */
export function dischargeLine(plan: Plan | undefined) {
  if (!plan) return "Your leaflet, medicines and warning signs";
  if (plan.status === "in-hospital") return "Ready for you when you go home";
  const { medicines: m } = plan, taking = m.new.length + m.changed.length + m.continue.length;
  const leaflet = plan.leaflets.find(l => l.language === plan.language)?.name;
  return [`${taking} ${taking === 1 ? "medicine" : "medicines"}`, m.new.length && `${m.new.length} new`, leaflet && `leaflet in ${leaflet}`].filter(Boolean).join(" · ");
}

export type Group = keyof Discharged["medicines"];
export type Med = Discharged["medicines"][Group][number];

/**
 * The page's quick insight: what the stay changed, one chip per group that has any ("1 new",
 * "1 changed", "1 stopped"), with the medicine a tap opens (the group's first).
 */
export function changeSummary(meds: Discharged["medicines"]) {
  return (["new", "changed", "stopped"] as const).filter(g => meds[g].length).map(g => ({ group: g, label: `${meds[g].length} ${g}`, first: meds[g][0]!.name }));
}

/** "9 PM", "8:30 AM" from the plan's "HH:MM" (already Malaysia time). */
const hour = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
};
/** A card's plain-language schedule: "Once a day, 8 AM", "Twice a day, 8 AM and 8 PM", "When you need it". */
export function scheduleLine({ at = [] }: Pick<Med, "at">) {
  if (!at.length) return "When you need it";
  const times = at.map(hour).join(", ").replace(/, ([^,]*)$/, " and $1");
  return `${["Once", "Twice"][at.length - 1] ?? `${at.length} times`} a day, ${times}`;
}

/** What the stay did to a medicine, in the patient's words (the open card's last line). */
export const CHANGE = { new: "Started in hospital", changed: "Changed in hospital", continue: "Same as before your stay" } as const;

/** The title's line: how long the patient has been home. */
export const homeLine = (days: number | undefined) => days === undefined || days <= 0 ? "Home since today" : days === 1 ? "Home since yesterday" : `Home for ${days} days`;

/** The medicines title's insight line: how many to take at home and what changed, then how long home ("3 to take · 1 new · 1 changed"). */
export function takeLine(meds: Discharged["medicines"], home: string) {
  const taking = meds.new.length + meds.changed.length + meds.continue.length;
  return [taking ? `${taking} to take` : "Nothing to take", meds.new.length && `${meds.new.length} new`, meds.changed.length && `${meds.changed.length} changed`, home].filter(Boolean).join(" · ");
}
