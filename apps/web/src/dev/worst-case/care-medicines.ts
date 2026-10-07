import { doseKey, doseSlots } from "@sona-ai/domain/doses";

import { ONE_DISCHARGED_DAYS, ONE_MEDS, WORST_DISCHARGED_DAYS, WORST_MEDS } from "./care-discharge-plan";
import { fixture } from "./fixture";

// Medicines reads care.discharge (registered in care-discharge-plan.ts), the doses marked taken and the hospital clock.
const DAY = 86_400_000, NOW = Date.now();

/** Keys of the doses marked taken over the last 8 days: most, not all (every third skipped), so the week shows missed dots and today some late ones. */
function taken(meds: typeof WORST_MEDS, days: number, skip: number) {
  const out = new Date(NOW - days * DAY), from = NOW - 8 * DAY;
  return [...meds.new, ...meds.changed, ...meds.continue].flatMap(m =>
    doseSlots(m, out, new Date(NOW)).filter(d => d.getTime() > from).map(d => doseKey(m.name, d))).filter((_, i) => i % skip !== 0);
}

export default [
  fixture("care.doses.list", {
    worst: taken(WORST_MEDS, WORST_DISCHARGED_DAYS, 3),
    empty: [],
    one: taken(ONE_MEDS, ONE_DISCHARGED_DAYS, 1e9),
    huge: taken(WORST_MEDS, WORST_DISCHARGED_DAYS, 1e9),
  }),
];
