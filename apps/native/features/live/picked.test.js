import { expect, test } from "bun:test";
import { splitPicked, titleOf } from "./picked";

test("picked files split into one PDF or the photos in order, and a mix, a stray type or too many photos are refused", () => {
  const f = (name, mimeType) => ({ name, mimeType });
  expect(splitPicked([f("guide.pdf", "application/pdf")])).toEqual({ pdf: f("guide.pdf", "application/pdf") });
  expect(splitPicked([f("p2.png"), f("IMG_1.HEIC.jpg", "image/jpeg")])).toEqual({ images: [{ file: f("p2.png"), contentType: "image/png" }, { file: f("IMG_1.HEIC.jpg", "image/jpeg"), contentType: "image/jpeg" }] });
  expect(splitPicked([f("a.pdf"), f("p1.jpg")])).toHaveProperty("error");
  expect(splitPicked([f("a.pdf"), f("b.pdf")])).toHaveProperty("error");
  expect(splitPicked([f("IMG_2.heic", "image/heic")])).toHaveProperty("error");
  expect(splitPicked([])).toHaveProperty("error");
  expect(splitPicked(Array.from({ length: 11 }, (_, i) => f(`p${i}.jpg`)))).toEqual({ error: "Up to 10 photos at a time; 11 were chosen." });
  expect(titleOf("Ward protocol.jpeg")).toBe("Ward protocol");
});
