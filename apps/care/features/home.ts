/** Days since the patient left hospital, counted on calendar days in the hospital's time zone (discharge day is day 0). */
export function daysHome(dischargedAt: string | undefined, now = new Date()) {
  if (!dischargedAt) return undefined;
  const day = (d: Date) => Math.floor((d.getTime() + 8 * 3600_000) / 86_400_000);
  return day(now) - day(new Date(dischargedAt));
}

/** The one line under the greeting: where they are, and how many things need them (zero reads as reassurance). */
export function insightLine(days: number | undefined, needs: number) {
  const where = days === undefined ? "Your care, between visits" : days === 0 ? "Home today" : `Day ${days} at home`;
  return `${where} · ${needs ? `${needs} ${needs === 1 ? "thing needs" : "things need"} you` : "nothing needs you today"}`;
}
