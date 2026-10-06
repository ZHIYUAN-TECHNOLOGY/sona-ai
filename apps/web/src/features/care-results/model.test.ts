import * as model from "./model";
// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { countsOf, isFlagged, leadOf, numberOf, statusOf, trendOf, type Result } from "./model";

test("statusOf reads the flag; countsOf leaves waiting results out of seen", () => {
  expect([statusOf(undefined), statusOf("normal"), statusOf("High"), statusOf("L"), statusOf("abnormal")]).toEqual(["Normal", "Normal", "Above", "Below", "Check"]);
  const c = countsOf([
    { id: "a", test: "K", at: "2026-01-02", released: true, value: "5.9", flag: "high" },
    { id: "b", test: "Na", at: "2026-01-02", released: true, value: "140" },
    { id: "c", test: "Hb", at: "2026-01-03", released: false },
  ]);
  expect([c.seen, c.inRange, c.attention.length, c.waiting]).toEqual([2, 1, 1, 1]);
});

const hb = (id: string, at: string, value: string, flag?: string): Result => ({ id, test: "Haemoglobin", at, released: true, value, unit: "g/dL", flag });
const waiting: Result = { id: "w", test: "Potassium", at: "2026-10-05T02:00:00.000Z", released: false };
const rows = [hb("c", "2026-10-04T02:00:00.000Z", "11.8", "low"), hb("b", "2026-10-03T02:00:00.000Z", "<10"), hb("a", "2026-10-02T02:00:00.000Z", "10.9")];

test("only plain numbers become chart points", () => {
  expect(numberOf(" 5.2 ")).toBe(5.2);
  for (const v of ["<5", "5-6", "Positive", "", "5.", "1e3"]) expect(numberOf(v)).toBeUndefined();
});

test("a trend is oldest first, skips what is not a number or not released, and needs two points", () => {
  expect(trendOf([waiting, ...rows], "Haemoglobin").map((p: { y: number }) => p.y)).toEqual([10.9, 11.8]);
  expect(trendOf(rows.slice(0, 2), "Haemoglobin")).toEqual([]);
  expect(trendOf([waiting, ...rows], "Potassium")).toEqual([]);
});

test("the lead is the newest result, amber when it is under review or flagged", () => {
  expect(leadOf([])).toBeUndefined();
  expect(leadOf([waiting, ...rows])).toEqual({ text: "Your care team is reviewing a new result.", tone: "soon" });
  expect(leadOf(rows)).toEqual({ text: "Your newest result: Haemoglobin was 11.8 g/dL on 4 Oct 2026.", tone: "soon", openId: "c" });
  expect(leadOf(rows.slice(2))?.tone).toBe("info");
  expect(isFlagged("Normal")).toBe(false);
});

test("improvedOf: newest in range after an earlier flagged value of the same test", () => {
  const r = (id: string, t: string, flag?: string) => ({ id, test: t, at: "2026-10-01", released: true as const, value: "1", flag });
  const out = model.improvedOf([r("a", "K", "normal"), r("b", "K", "high"), r("c", "Na", "low"), r("d", "Na", "normal"), r("e", "Hb")]);
  expect(out.map((x) => x.id)).toEqual(["a"]);
  expect(model.plainOf("H")).toBe("Above the usual range");
});
