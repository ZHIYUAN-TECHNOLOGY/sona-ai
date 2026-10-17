// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { countOf, formatNumber } from "../lib/format";
import { initials } from "./avatar";

test("initials take whole letters from the first and last name", () => {
  expect(initials("Dr Aleksandra Wiśniewska-Kowalczyk")).toBe("AW");
  expect(initials("Christopher Alexander Montgomery III")).toBe("CM");
  expect(initials("Ólafur Darri Ólafsson")).toBe("ÓÓ");
  expect(initials("Jo")).toBe("J");
  expect(initials("dana")).toBe("D");
  expect(initials("  Sam   Lee ")).toBe("SL");
  expect(initials("🦊 Fox")).toBe("F");
  expect(initials("王秀英")).toBe("王");
  expect(initials("")).toBe("");
  expect(initials("👩🏽‍💻")).toBe("");
});

test("initials skip Malaysian honorifics, however many lead the name", () => {
  expect(initials("Dato' Seri Ahmad Zulkifli bin Abdullah")).toBe("AA");
  expect(initials("Datin Siti Nurhaliza")).toBe("SN");
  expect(initials("Datuk Lim Kok Wing")).toBe("LW");
  expect(initials("Tan Sri Dato’ Haji Muhyiddin Yassin")).toBe("MY");
  expect(initials("Puan Sri Hajah Rosmah Mansor")).toBe("RM");
  expect(initials("Hjh. Aminah Ismail")).toBe("AI");
  expect(initials("Prof. Dr Kamala Devi")).toBe("KD");
  expect(initials("Tan Wei Ming")).toBe("TM");
  expect(initials("Dato'")).toBe("D");
});

test("numbers and counted nouns", () => {
  expect(formatNumber(1284)).toBe("1,284");
  expect(formatNumber(3.14159)).toBe("3.14159");
  expect(countOf(1, "patient")).toBe("1 patient");
  expect(countOf(0, "patient")).toBe("0 patients");
  expect(countOf(1284, "reply", "replies")).toBe("1,284 replies");
});
