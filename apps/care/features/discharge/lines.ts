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
