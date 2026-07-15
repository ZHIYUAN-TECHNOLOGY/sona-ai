import { describe, expect, it } from "vitest";

import { normalizeModelMarkdown } from "./noteGen";

// Format-normalization regressions (kept separate from noteGen.test.ts, which
// drags in the grounding module). Pure string-in/string-out.
describe("normalizeModelMarkdown", () => {
  it("never splits a valid heading (## Subjective stays intact)", () => {
    expect(normalizeModelMarkdown("## Subjective\n- fever")).toBe("## Subjective\n- fever");
  });

  it("adds the missing space to a glued heading", () => {
    expect(normalizeModelMarkdown("##Subjective\n- fever")).toBe("## Subjective\n- fever");
  });

  it("breaks a mid-line heading onto its own line (device screenshot Jul 15)", () => {
    expect(
      normalizeModelMarkdown('prose about "sakit". ## Summary - Patient reports worsening'),
    ).toBe('prose about "sakit".\n## Summary - Patient reports worsening');
  });
});
