import { expect, test } from "bun:test";
import { tFor } from "@/lib/i18n";
import "./strings";
import { addWaiting, medLine, messageFor } from "./photo-model";

test("the care message says what was read and where the photo is, in the patient's language", () => {
  const read = { name: "Cetirizine", dose: "10 mg", how: "once at night" };
  expect(medLine(read)).toBe("Cetirizine 10 mg, once at night");
  expect(messageFor({ ...read, key: "care-photos/demo/SYN-1042/a.jpg" }, tFor("en"))).toBe("Please check a medicine I added from a photo: Cetirizine 10 mg, once at night. Photo: care-photos/demo/SYN-1042/a.jpg");
  expect(messageFor(read, tFor("ms"))).toContain("Cetirizine 10 mg, once at night");
  expect(messageFor(read, tFor("zh"))).toContain("Cetirizine 10 mg");
  expect(medLine({ name: "Cetirizine" })).toBe("Cetirizine");
});

test("sending the same medicine again keeps one waiting entry", () => {
  const a = { id: "1", name: "Cetirizine", sentAt: "t1" }, b = { id: "2", name: "cetirizine", dose: "10 mg", sentAt: "t2" };
  expect(addWaiting(addWaiting([], a), b)).toEqual([b]);
});
