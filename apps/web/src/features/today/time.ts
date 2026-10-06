/** The hospital's clock. The server reads a calendar day at +08:00 (`day.list`), so the page does too. */
const timeZone = "Asia/Kuala_Lumpur";

const keyFormat = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" });
const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric" });
const longFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const whenFormat = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** `2026-10-06` for an instant, in the hospital's time. */
export const dateKey = (at: Date) => keyFormat.format(at);
export const timeOf = (at: Date) => timeFormat.format(at);
export const hourOf = (at: Date) => Number(hourFormat.format(at));
export const whenOf = (at: Date) => whenFormat.format(at);

const noon = (key: string) => new Date(`${key}T12:00:00Z`);
export const addDays = (key: string, days: number) => new Date(noon(key).getTime() + days * 86_400_000).toISOString().slice(0, 10);
export const dayLabel = (key: string) => dayFormat.format(noon(key));
export const longLabel = (key: string) => longFormat.format(noon(key));

/** The seven date keys, Monday to Sunday, of the week holding `key`. */
export function weekOf(key: string): string[] {
  const monday = addDays(key, -((noon(key).getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
