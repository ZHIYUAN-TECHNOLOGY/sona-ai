import { expect, test } from "bun:test";
import { dayParts, DOCTORS, initials, listFor, matchDoctors, nameLines, searchDoctors, slotOf } from "./data";

test("search matches name or specialty in any case; empty keeps the list", () => {
  expect(searchDoctors(DOCTORS, "cardio").map(d => d.id)).toEqual(["aisyah"]);
  expect(searchDoctors(DOCTORS, " lim ").map(d => d.id)).toEqual(["lim"]);
  expect(searchDoctors(DOCTORS, "")).toHaveLength(DOCTORS.length);
  expect(searchDoctors(DOCTORS, "zzz")).toEqual([]);
});

test("initials and the two-line name leave the title out of the avatar", () => {
  expect(initials("Dr. Lim Wei Jie")).toBe("LW");
  expect(initials("Dr. Aisyah Rahman")).toBe("AR");
  expect(nameLines("Dr. Lim Wei Jie")).toEqual(["Dr. Lim", "Wei Jie"]);
  expect(nameLines("Dr. Aisyah Rahman")).toEqual(["Dr. Aisyah", "Rahman"]);
});

test("a day chip reads the Malaysia date", () => {
  expect(dayParts(new Date("2026-09-28T04:00:00Z"))).toEqual({ weekday: "Mon", date: "28", spoken: "Monday 28 September" });
});

test("pneumonia finds the respiratory doctor first; heart finds cardiology", () => {
  expect(matchDoctors(DOCTORS, "After my pneumonia I still cough")[0].id).toBe("lim");
  expect(matchDoctors(DOCTORS, "heart problem")[0].specialty).toBe("Cardiology");
  expect(matchDoctors(DOCTORS, "nothing relevant")).toEqual([]);
});

test("filters: care team only; top rated in order", () => {
  expect(listFor(DOCTORS, "care-team").every(d => d.careTeam)).toBe(true);
  const top = listFor(DOCTORS, "top-rated").map(d => d.rating);
  expect(top).toEqual([...top].sort((a, b) => b - a));
  expect(listFor(DOCTORS, "all")).toHaveLength(DOCTORS.length);
});

test("a free time from the API reads as a slot in Malaysia time", () => {
  expect(slotOf("2026-09-28T01:00:00.000Z")).toEqual({ date: new Date("2026-09-28T01:00:00.000Z"), label: "9:00 AM" });
});
