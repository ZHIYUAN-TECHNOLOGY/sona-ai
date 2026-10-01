import { expect, test } from "bun:test";
import { tFor } from "@/lib/i18n";
import "./strings";
import { addWaiting, afterRead, medLine, messageFor, statusOf, unplanned } from "./photo-model";

test("a reading of their own photo is shown as read; the sample's words are never offered as their own photo's", () => {
  const model = { name: "Amlodipine", dose: "5 mg", source: "model", model: "medgemma-1.5-4b" };
  expect(afterRead(model, true)).toEqual({ reading: { name: "Amlodipine", dose: "5 mg", how: undefined }, sample: false });
  const sample = { name: "Cetirizine", dose: "10 mg", frequency: "once at night", source: "fixture" };
  // The bundled sample photo: the sample's reading, labelled.
  expect(afterRead(sample, false)).toEqual({ reading: { name: "Cetirizine", dose: "10 mg", how: "once at night" }, sample: true });
  // Their own photo came back as the sample: nothing was read, so they type it (and are told when the reader is starting).
  expect(afterRead(sample, true)).toEqual({ reading: { name: "" }, sample: false, unread: { waking: undefined } });
  expect(afterRead({ ...sample, waking: 4 }, true).unread).toEqual({ waking: 4 });
  expect(tFor("en")("photo.starting", { min: 4 })).toBe("Photo reading is starting (about 4 min). Type the medicine in below, or try again then.");
});

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
