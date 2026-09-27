/** Days since the patient left hospital, counted on calendar days in the hospital's time zone (discharge day is day 0). */
export function daysHome(dischargedAt: string | undefined, now = new Date()) {
  if (!dischargedAt) return undefined;
  const day = (d: Date) => Math.floor((d.getTime() + 8 * 3600_000) / 86_400_000);
  return day(now) - day(new Date(dischargedAt));
}

/** The home title: where the patient is, with the part to glance at (the accent) first. */
export function whereWords(days: number | undefined): [accent: string, rest: string] {
  return days === undefined ? ["Your care", " between visits"] : days === 0 ? ["Home", " today"] : [`Day ${days}`, " at home"];
}

/** The line under the title: how many things need the patient (zero reads as reassurance). */
export const needsLine = (needs: number) => needs ? `${needs} ${needs === 1 ? "thing needs" : "things need"} you` : "Nothing needs you today";
