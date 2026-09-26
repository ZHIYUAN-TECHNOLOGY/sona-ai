import { expect, test } from "bun:test";
import { dischargeLine } from "./lines";

const med = name => ({ name, line: "" });
test("the home row sums up the plan in one line: medicines to take, what is new, the leaflet's language", () => {
  const plan = { status: "discharged", language: "ms", leaflets: [{ language: "ms", name: "Bahasa Melayu" }, { language: "en", name: "English" }],
    medicines: { new: [med("Paracetamol")], changed: [med("Azithromycin")], stopped: [med("Salbutamol nebuliser")], continue: [med("Cetirizine")] } };
  expect(dischargeLine(plan)).toBe("3 medicines · 1 new · leaflet in Bahasa Melayu");
  expect(dischargeLine({ ...plan, medicines: { new: [], changed: [med("A")], stopped: [], continue: [] } })).toBe("1 medicine · leaflet in Bahasa Melayu");
  expect(dischargeLine({ status: "in-hospital" })).toBe("Ready for you when you go home");
  expect(dischargeLine(undefined)).toBe("Your leaflet, medicines and warning signs");
});
