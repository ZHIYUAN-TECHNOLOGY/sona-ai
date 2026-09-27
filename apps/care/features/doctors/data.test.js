import { expect, test } from "bun:test";
import { bookingText, DOCTORS, doctorById, listFor, matchDoctors, slots } from "./data";

test("pneumonia finds the respiratory doctor first; heart finds cardiology", () => {
  expect(matchDoctors("After my pneumonia I still cough")[0].id).toBe("lim");
  expect(matchDoctors("heart problem")[0].specialty).toBe("Cardiology");
  expect(matchDoctors("nothing relevant")).toEqual([]);
});

test("filters: care team only; top rated in order", () => {
  expect(listFor("care-team").every(d => d.careTeam)).toBe(true);
  const top = listFor("top-rated").map(d => d.rating);
  expect(top).toEqual([...top].sort((a, b) => b - a));
  expect(listFor("all")).toHaveLength(DOCTORS.length);
});

test("slots fall on the doctor's clinic days from tomorrow, in Malaysia time", () => {
  const lim = doctorById("lim");
  const days = slots(lim, new Date("2026-09-27T04:00:00Z"), 7); // Sun 27 Sep, noon MYT
  const weekdays = days.map(d => new Date(d.day.getTime() + 8 * 3600_000).getUTCDay());
  expect(weekdays.every(w => lim.days.includes(w))).toBe(true);
  expect(days[0].times[0].date.toISOString()).toBe("2026-09-28T01:00:00.000Z"); // Mon 28 Sep 09:00 MYT
  expect(days[0].times[0].label).toBe("9:00 AM");
});

test("a booking request names the doctor, the time and asks for confirmation", () => {
  const text = bookingText(doctorById("lim"), new Date("2026-09-28T01:00:00Z"), "follow-up after pneumonia");
  expect(text).toContain("Dr. Lim Wei Jie (Respiratory)");
  expect(text).toContain("Mon 28 Sep, 9:00 AM");
  expect(text).toContain("Reason: follow-up after pneumonia.");
  expect(text.endsWith("Please confirm.")).toBe(true);
});
