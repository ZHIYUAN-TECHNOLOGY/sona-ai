import { expect, test } from "bun:test";
import { dischargeLine, homeLine, scheduleLine, takeLine, takeSentence } from "./lines";

const med = name => ({ name, line: "" });
const medicines = { new: [med("Paracetamol")], changed: [med("Azithromycin")], stopped: [med("Salbutamol nebuliser")], continue: [med("Cetirizine")] };
test("the home row sums up the plan in one line: medicines to take, what is new, the leaflet's language", () => {
  const plan = { status: "discharged", language: "ms", leaflets: [{ language: "ms", name: "Bahasa Melayu" }, { language: "en", name: "English" }], medicines };
  expect(dischargeLine(plan)).toBe("3 medicines · 1 new · leaflet in Bahasa Melayu");
  expect(dischargeLine({ ...plan, medicines: { new: [], changed: [med("A")], stopped: [], continue: [] } })).toBe("1 medicine · leaflet in Bahasa Melayu");
  expect(dischargeLine({ status: "in-hospital" })).toBe("Ready for you when you go home");
  expect(dischargeLine(undefined)).toBe("Your leaflet, medicines and warning signs");
});

test("the schedule reads as a patient would say it", () => {
  expect(scheduleLine({ at: ["08:00"] })).toBe("Once a day, 8 AM");
  expect(scheduleLine({ at: ["08:00", "20:30"] })).toBe("Twice a day, 8 AM and 8:30 PM");
  expect(scheduleLine({ at: ["00:00", "12:00", "18:00"] })).toBe("3 times a day, 12 AM, 12 PM and 6 PM");
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

test("the sheet's sentence bolds the dose and when, and falls back to the plan line without a schedule", () => {
  const text = runs => runs.map(r => r.bold ? `**${r.text}**` : r.text).join("");
  expect(text(takeSentence({ line: "x", take: "1 tablet, with or without food", at: ["08:00"] }))).toBe("You have to take **1 tablet**, **once a day at 8 AM**, with or without food.");
  expect(text(takeSentence({ line: "x", take: "1 tablet at night", at: ["21:00"] }))).toBe("You have to take **1 tablet at night**, **once a day at 9 PM**.");
  expect(text(takeSentence({ line: "x", at: ["08:00", "20:00"] }))).toBe("Take it **twice a day at 8 AM and 8 PM**.");
  expect(takeSentence({ line: "For pain or fever, if you need it" })).toEqual([{ text: "For pain or fever, if you need it" }]);
});
