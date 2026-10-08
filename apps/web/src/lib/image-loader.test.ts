// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { describe, expect, test } from "bun:test";

import { copyFor, easeOut, firstPhase, LOADER_COPY, MESSAGE_MS, messageAt, nextPhase, REVEAL_MS } from "./image-loader";

describe("nextPhase", () => {
  test("waits while loading, even with the image decoded", () => expect(nextPhase("pending", "loading", true)).toBe("pending"));
  test("waits for the image to decode", () => expect(nextPhase("pending", "ready", false)).toBe("pending"));
  test("dissolves once the image is in", () => expect(nextPhase("pending", "ready", true)).toBe("reveal"));
  test("a reveal runs to its end", () => expect(nextPhase("reveal", "ready", true)).toBe("reveal"));
  test("reading still reveals first", () => expect(nextPhase("pending", "reading", true)).toBe("reveal"));
  test("a shown image takes a scan without a second reveal", () => expect(nextPhase("visible", "reading", true)).toBe("reading"));
  test("the scan ends when the read does", () => expect(nextPhase("reading", "ready", true)).toBe("visible"));
  test("failed is still, from anywhere", () => { for (const p of ["pending", "reveal", "visible", "reading"] as const) expect(nextPhase(p, "failed", true)).toBe("failed"); });
  test("a retry that lands reveals", () => expect(nextPhase("failed", "ready", true)).toBe("reveal"));
  test("a new image goes back to the field", () => expect(nextPhase("visible", "loading", true)).toBe("pending"));
  test("an image already in hand shows at once", () => expect(firstPhase("ready", true)).toBe("visible"));
  test("mounting on a pending image waits", () => expect(firstPhase("ready", false)).toBe("pending"));
  test("the reveal is about 600 ms", () => expect(REVEAL_MS).toBe(600));
});

describe("messageAt", () => {
  test("starts on the first", () => expect(messageAt(0, 3)).toBe(0));
  test("moves on every 2.2 s", () => {
    expect(MESSAGE_MS).toBe(2200);
    expect(messageAt(2199, 3)).toBe(0);
    expect(messageAt(2200, 3)).toBe(1);
    expect(messageAt(4400, 3)).toBe(2);
  });
  test("holds on the last instead of starting over", () => expect(messageAt(60_000, 3)).toBe(2));
  test("one message stays put", () => expect(messageAt(9000, 1)).toBe(0));
});

describe("copyFor", () => {
  test("a film loading is fetched and developed", () => expect(copyFor("loading", "film")).toBe(LOADER_COPY.film));
  test("a film being read names Sona Vision first", () => expect(copyFor("reading", "film")[0]).toBe("Sona Vision is reading the film"));
  test("pages are read", () => expect(copyFor("reading", "paper")).toBe(LOADER_COPY.scan));
  test("failed says so plainly", () => expect(copyFor("failed", "film")).toEqual(["Film not available"]));
});

test("easeOut is clamped and ends at 1", () => {
  expect(easeOut(-1)).toBe(0);
  expect(easeOut(1)).toBe(1);
  expect(easeOut(0.5)).toBeGreaterThan(0.5);
});
