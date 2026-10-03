import { expect, test } from "bun:test";
import { homeLine, scheduleLine, takeLine, takeSentence } from "./lines";

const med = name => ({ name, line: "" });
const medicines = { new: [med("Paracetamol")], changed: [med("Azithromycin")], stopped: [med("Salbutamol nebuliser")], continue: [med("Cetirizine")] };
test("the schedule reads as a patient would say it", () => {
  expect(scheduleLine({ at: ["08:00"] })).toBe("Once a day, 8\u00a0AM");
  expect(scheduleLine({ at: ["08:00", "20:30"] })).toBe("Twice a day, 8\u00a0AM and 8:30\u00a0PM");
  expect(scheduleLine({ at: ["00:00", "12:00", "18:00"] })).toBe("3 times a day, 12\u00a0AM, 12\u00a0PM and 6\u00a0PM");
  expect(scheduleLine({})).toBe("When you need it");
});

test("the title line counts days at home", () => {
  expect(homeLine(0)).toBe("Home since today");
  expect(homeLine(1)).toBe("Home since yesterday");
  expect(homeLine(3)).toBe("Home for 3 days");
});

test("the medicines title line says how many to take, what changed and how long home", () => {
  const meds = { new: [{ name: "A" }], changed: [{ name: "B" }], continue: [{ name: "C" }], stopped: [{ name: "D" }] };
  expect(takeLine(meds, "Home since today")).toBe("3 to take · 1 new · 1 changed · Home since today");
  expect(takeLine({ new: [], changed: [], continue: [], stopped: [] }, "Home for 3 days")).toBe("Nothing to take · Home for 3 days");
});

test("a finished course reads as finished on its last day, and no longer counts as one to take", () => {
  const azithro = { name: "Azithromycin", line: "Course finished, nothing left to take", take: "1 tablet", at: ["08:00"], endsAt: new Date("2026-10-01T00:00:00Z"), finished: true };
  expect(scheduleLine(azithro)).toBe("Finished Thu 1 Oct");
  expect(scheduleLine(azithro, "ms")).toBe("Selesai Kha 1 Okt");
  expect(scheduleLine(azithro, "zh")).toBe("已服完 · 10月1日 周四");
  expect(takeSentence(azithro)).toEqual([{ text: "Finished Thu 1 Oct", bold: true }]);
  expect(scheduleLine({ ...azithro, finished: undefined })).toBe("Once a day, 8\u00a0AM"); // still going: its last dose shows nowhere new
  expect(takeLine({ new: [{ name: "A" }], changed: [azithro], continue: [{ name: "C" }], stopped: [] }, "Home for 5 days")).toBe("2 to take · 1 new · Home for 5 days");
});

test("the sheet's sentence bolds the dose and when, and falls back to the plan line without a schedule", () => {
  const text = runs => runs.map(r => r.bold ? `**${r.text}**` : r.text).join("");
  expect(text(takeSentence({ line: "x", take: "1 tablet, with or without food", at: ["08:00"] }))).toBe("You have to take **1 tablet**, **once a day at 8\u00a0AM**, with or without food.");
  expect(text(takeSentence({ line: "x", take: "1 tablet at night", at: ["21:00"] }))).toBe("You have to take **1 tablet at night**, **once a day at 9\u00a0PM**.");
  expect(text(takeSentence({ line: "x", at: ["08:00", "20:00"] }))).toBe("Take it **twice a day at 8\u00a0AM and 8\u00a0PM**.");
  expect(takeSentence({ line: "For pain or fever, if you need it" })).toEqual([{ text: "For pain or fever, if you need it" }]);
});
