// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { describe, expect, test } from "bun:test";

import { captionFor, follow, pickRenderer, voiceNext } from "./voice";

describe("voiceNext", () => {
  test("the mic opens, then closes into transcribing", () => {
    expect(voiceNext("idle", "mic")).toBe("listening");
    expect(voiceNext("listening", "mic")).toBe("transcribing");
  });
  test("the mic does nothing while the words are being read", () => expect(voiceNext("transcribing", "mic")).toBe("transcribing"));
  test("done or failed, from anywhere, back to idle", () => {
    for (const phase of ["idle", "listening", "transcribing"] as const) {
      expect(voiceNext(phase, "done")).toBe("idle");
      expect(voiceNext(phase, "fail")).toBe("idle");
    }
  });
});

describe("captionFor", () => {
  test("says how to send while listening, what Sona does after, then the words", () => {
    expect(captionFor("listening", "old")).toBe("Listening… tap the mic to send");
    expect(captionFor("transcribing")).toBe("Reading what you said…");
    expect(captionFor("idle", "Which beds are blocked?")).toBe("Which beds are blocked?");
    expect(captionFor("idle")).toBe("");
  });
});

describe("follow", () => {
  const settle = (from: number, to: number, ms: number) => {
    let env = from;
    for (let t = 0; t < ms; t += 16) env = follow(env, to, 16);
    return env;
  };
  test("rises fast (most of the way in 160 ms) and falls slowly (most of the way in 700 ms)", () => {
    expect(settle(0, 1, 160)).toBeGreaterThan(0.8);
    expect(settle(1, 0, 160)).toBeGreaterThan(0.5);
    expect(settle(1, 0, 700)).toBeLessThan(0.15);
  });
  test("the same at any frame rate", () => {
    const at60 = settle(0, 1, 96), at120 = (() => { let e = 0; for (let i = 0; i < 12; i++) e = follow(e, 1, 8); return e; })();
    expect(Math.abs(at60 - at120)).toBeLessThan(0.01);
  });
  test("a zero or negative step holds still", () => expect(follow(0.4, 1, -5)).toBe(0.4));
});

describe("pickRenderer", () => {
  test("WebGPU first, then WebGL 2, then CSS", () => {
    expect(pickRenderer({ gpu: true, webgl2: true })).toBe("webgpu");
    expect(pickRenderer({ gpu: false, webgl2: true })).toBe("webgl2");
    expect(pickRenderer({ gpu: false, webgl2: false })).toBe("css");
  });
});
