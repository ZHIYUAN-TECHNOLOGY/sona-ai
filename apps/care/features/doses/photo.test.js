import { expect, test } from "bun:test";
import { tFor } from "@/lib/i18n";
import "./strings";
import { addWaiting, medLine, messageFor, statusOf, unplanned } from "./photo-model";

test("the care message says what was read, in the patient's language", () => {
  const read = { name: "Cetirizine", dose: "10 mg", how: "once at night" };
  expect(medLine(read)).toBe("Cetirizine 10 mg, once at night");
  expect(messageFor(read, tFor("en"))).toBe("Please check a medicine I added from a photo: Cetirizine 10 mg, once at night.");
  expect(messageFor(read, tFor("ms"))).toContain("Cetirizine 10 mg, once at night");
  expect(messageFor(read, tFor("zh"))).toContain("Cetirizine 10 mg");
  expect(medLine({ name: "Cetirizine" })).toBe("Cetirizine");
});

test("sending the same medicine again keeps one waiting entry", () => {
  const a = { id: "1", name: "Cetirizine", sentAt: "t1" }, b = { id: "2", name: "cetirizine", dose: "10 mg", sentAt: "t2" };
  expect(addWaiting(addWaiting([], a), b)).toEqual([b]);
});

test("a waiting medicine follows the care team's decision on its message", () => {
  const m = { id: "care-photo-1" };
  expect(statusOf(m, undefined)).toBe("waiting");
  expect(statusOf(m, [{ id: "message:SYN-1042:care-photo-1", attachment: { kind: "medicine-photo" } }])).toBe("waiting");
  expect(statusOf(m, [{ id: "message:SYN-1042:care-photo-1", attachment: { decision: { status: "added" } } }])).toBe("added");
  expect(statusOf(m, [{ id: "message:SYN-1042:care-photo-12", attachment: { decision: { status: "declined" } } }])).toBe("waiting");
});

test("a photo medicine the plan already lists isn't shown twice", () => {
  const cet = { id: "1", name: "Cetirizine", sentAt: "t" }, vit = { id: "2", name: "Vitamin D 1000 IU", sentAt: "t" };
  expect(unplanned([cet, vit], ["Paracetamol", "cetirizine 10 mg"])).toEqual([vit]);
  expect(unplanned([cet], [])).toEqual([cet]);
});
