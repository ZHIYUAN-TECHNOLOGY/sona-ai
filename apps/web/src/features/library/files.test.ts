// @ts-ignore -- apps/web has no Bun types installed; drop this line once @types/bun is a devDependency.
import { expect, test } from "bun:test";

import { boxStyle, highlightSegments, isStale, scanPages, splitPicked, titleOf } from "./files";

test("unsure words are highlighted whole, Chinese by character, in text order", () => {
  const text = "Take 5 mg omg 服用阿司匹林 daily";
  const segs = highlightSegments(text, ["mg", "阿司", "daily"]);
  expect(segs.filter(s => s.unsure).map(s => s.text)).toEqual(["mg", "阿司", "daily"]);
  expect(segs.map(s => s.text).join("")).toBe(text);
  expect(highlightSegments("nothing here", ["no"])).toEqual([{ text: "nothing here", unsure: false }]);
  expect(highlightSegments("", ["x"])).toEqual([]);
});

test("boxes in thousandths and in fractions land on the same place", () => {
  const expected = { top: "29%", left: "26%", height: "10%", width: "8%" };
  const round = (s: Record<string, string>) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, `${Math.round(parseFloat(v))}%`]));
  expect(round(boxStyle([290, 260, 390, 340]))).toEqual(expected);
  expect(round(boxStyle([0.29, 0.26, 0.39, 0.34]))).toEqual(expected);
});

test("a box outside the image is clamped to it", () => {
  expect(boxStyle([-50, 900, 1200, 1100])).toEqual({ top: "0%", left: "90%", height: "100%", width: "10%" });
});

test("a source is stale from five years old", () => {
  expect(isStale(2021, 2026)).toBe(true);
  expect(isStale(2022, 2026)).toBe(false);
});

test("picked files split into one PDF or the photos in order, and a mix, a stray type or too many photos are refused", () => {
  const f = (name: string, type = "") => ({ name, type });
  expect(splitPicked([f("guide.pdf", "application/pdf")])).toEqual({ pdf: f("guide.pdf", "application/pdf") });
  expect(splitPicked([f("p2.png"), f("p1.JPG")])).toEqual({ images: [{ file: f("p2.png"), contentType: "image/png" }, { file: f("p1.JPG"), contentType: "image/jpeg" }] });
  expect(splitPicked([f("a.pdf"), f("p1.jpg")])).toHaveProperty("error");
  expect(splitPicked([f("a.pdf"), f("b.pdf")])).toHaveProperty("error");
  expect(splitPicked([f("notes.docx")])).toHaveProperty("error");
  expect(splitPicked([])).toHaveProperty("error");
  expect(splitPicked(Array.from({ length: 11 }, (_, i) => f(`p${i}.jpg`)))).toEqual({ error: "Up to 10 photos at a time; 11 were chosen." });
  expect(titleOf("Ward protocol.jpeg")).toBe("Ward protocol");
});

test("checked scan pages drop the empty ones, and all empty is refused", () => {
  expect(scanPages(["  Dose 5 mg ", "", "  \n", "Page three"])).toEqual({ pages: ["Dose 5 mg", "Page three"] });
  expect(scanPages(["", " "])).toEqual({ error: "Every page is empty. Type the text of at least one page, or cancel." });
});
