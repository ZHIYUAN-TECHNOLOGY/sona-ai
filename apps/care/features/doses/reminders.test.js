import { expect, test } from "bun:test";
import { doseKey } from "@sona-ai/domain/doses";
import { doseReminders, reminderUrl, REMINDER_CAP } from "./reminders";

// Discharged 10:00 Malaysia time (02:00Z) on 27 Sep; azithromycin 08:00 for 2 more doses, cetirizine nightly at 21:00.
const out = "2026-09-27T02:00:00Z";
const meds = [
  { name: "Azithromycin", line: "Now a tablet once a day, for 2 more days", at: ["08:00"], doses: 2 },
  { name: "Paracetamol", line: "If you need it" },
  { name: "Cetirizine", line: "Keep taking it as before", at: ["21:00"] },
];
const now = new Date("2026-09-27T05:00:00Z"); // 13:00 in Malaysia, discharge day
const iso = list => list.map(r => r.at.toISOString());

test("a week of doses ahead, earliest first, each keyed and opening its own dose", () => {
  const list = doseReminders({ meds, dischargedAt: out, taken: [], now });
  // 7 nightly cetirizine (27 Sep to 3 Oct) and the 2 azithromycin doses; nothing past 4 Oct 13:00.
  expect(list).toHaveLength(9);
  expect(iso(list).slice(0, 4)).toEqual(["2026-09-27T13:00:00.000Z", "2026-09-28T00:00:00.000Z", "2026-09-28T13:00:00.000Z", "2026-09-29T00:00:00.000Z"]);
  expect(list.at(-1).at.toISOString()).toBe("2026-10-03T13:00:00.000Z");
  expect(iso(list)).toEqual([...iso(list)].sort());
  expect(list[0]).toEqual({ id: "dose:Cetirizine@2026-09-27T13:00:00.000Z", at: new Date("2026-09-27T13:00:00Z"), doseKey: "Cetirizine@2026-09-27T13:00:00.000Z" });
  expect(reminderUrl(list[0].doseKey)).toBe("sona-care:///dose?key=Cetirizine%402026-09-27T13%3A00%3A00.000Z");
  expect(doseReminders({ meds, dischargedAt: undefined, taken: [], now })).toEqual([]);
});

test("doses already taken and doses already past get no reminder", () => {
  const taken = [doseKey("Cetirizine", new Date("2026-09-27T13:00:00Z"))];
  expect(doseReminders({ meds, dischargedAt: out, taken, now })[0].doseKey).toBe("Azithromycin@2026-09-28T00:00:00.000Z");
  const later = doseReminders({ meds, dischargedAt: out, taken: [], now: new Date("2026-09-28T01:00:00Z") });
  expect(later[0].at.toISOString()).toBe("2026-09-28T13:00:00.000Z");
  expect(later.some(r => r.doseKey.startsWith("Azithromycin@2026-09-28"))).toBe(false);
});

test("the demo clock: a reminder fires at dose time minus the offset, and a dose already due on the demo clock is skipped", () => {
  const list = doseReminders({ meds, dischargedAt: out, taken: [], now, offsetMs: 86_400_000 }); // demo is a day ahead
  expect(list[0]).toMatchObject({ doseKey: "Cetirizine@2026-09-28T13:00:00.000Z", at: new Date("2026-09-27T13:00:00Z") });
  expect(list.some(r => r.doseKey === "Azithromycin@2026-09-28T00:00:00.000Z")).toBe(false);
  expect(list.every(r => r.at > now)).toBe(true);
  expect(list).toHaveLength(8); // cetirizine 28 Sep to 4 Oct, and azithromycin on 29 Sep
});

test("at most 60, the earliest kept", () => {
  const hourly = [{ name: "Test", line: "Every hour", at: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`) }];
  const list = doseReminders({ meds: hourly, dischargedAt: out, taken: [], now });
  expect(list).toHaveLength(REMINDER_CAP);
  expect(list[0].at.toISOString()).toBe("2026-09-27T06:00:00.000Z");
  expect(list.at(-1).at.toISOString()).toBe("2026-09-29T17:00:00.000Z");
});
