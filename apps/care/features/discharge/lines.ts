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

/** "9 PM", "8:30 AM" from the plan's "HH:MM" (already Malaysia time). */
const hour = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
};
const times = (at: string[]) => at.map(hour).join(", ").replace(/, ([^,]*)$/, " and $1");
const often = (n: number) => ["Once", "Twice"][n - 1] ?? `${n} times`;
/** A card's plain-language schedule: "Once a day, 8 AM", "Twice a day, 8 AM and 8 PM", "When you need it". */
export function scheduleLine({ at = [] }: Pick<Med, "at">) {
  return at.length ? `${often(at.length)} a day, ${times(at)}` : "When you need it";
}

/** What the stay did to a medicine, in the patient's words (the sheet's grey line). */
export const CHANGE = { new: "Started in hospital", changed: "Changed in hospital", continue: "Same as before your stay", stopped: "Stopped in hospital" } as const;

/**
 * The sheet's sentence as runs of plain and bold text: "You have to take **1 tablet**, **once a day at
 * 8 AM**, with or without food." from how to take one dose and its times; without a schedule, the plan line.
 */
export function takeSentence({ line, take, at = [] }: Pick<Med, "line" | "take" | "at">): { text: string; bold?: boolean }[] {
  if (!at.length) return [{ text: line }];
  const when = { text: `${often(at.length).toLowerCase()} a day at ${times(at)}`, bold: true };
  if (!take) return [{ text: "Take it " }, when, { text: "." }];
  const [dose = take, ...rest] = take.split(", ");
  return [{ text: "You have to take " }, { text: dose, bold: true }, { text: ", " }, when, { text: rest.length ? `, ${rest.join(", ")}.` : "." }];
}

/** The title's line: how long the patient has been home. */
export const homeLine = (days: number | undefined) => days === undefined || days <= 0 ? "Home since today" : days === 1 ? "Home since yesterday" : `Home for ${days} days`;

/** The medicines title's insight line: how many to take at home and what changed, then how long home ("3 to take · 1 new · 1 changed"). */
export function takeLine(meds: Discharged["medicines"], home: string) {
  const taking = meds.new.length + meds.changed.length + meds.continue.length;
  return [taking ? `${taking} to take` : "Nothing to take", meds.new.length && `${meds.new.length} new`, meds.changed.length && `${meds.changed.length} changed`, home].filter(Boolean).join(" · ");
}
