import { describe, expect, it } from "vitest";

import {
  hardenStreamingMarkdown,
  highlightClinical,
  normalizeNoteMarkdown,
  repairSoapStructure,
} from "./noteHighlight";

describe("repairSoapStructure", () => {
  it("rebuilds headings from label-shaped prose with typos (device screenshot #150)", () => {
    const raw = [
      "Subjectve – Patient reports persistent yellow-colored productive croup",
      "Objectve: Temperature 37.9",
      "Asessment - Viral URTI",
      "Plan; Paracetamol 1 g",
      "Orders and follow-ups: Review in five days",
    ].join("\n");
    const out = repairSoapStructure(raw);
    expect(out).toContain("## Subjective\nPatient reports persistent");
    expect(out).toContain("## Objective\nTemperature 37.9");
    expect(out).toContain("## Assessment\nViral URTI");
    expect(out).toContain("## Plan\nParacetamol 1 g");
    expect(out).toContain("## Orders & follow-ups\nReview in five days");
  });

  it("repairs bare label lines and leaves proper headings alone (idempotent)", () => {
    const raw = "Assessment\n- Tonsillitis, likely viral";
    const once = repairSoapStructure(raw);
    expect(once).toBe("## Assessment\n- Tonsillitis, likely viral");
    expect(repairSoapStructure(once)).toBe(once);
  });

  it("never converts bullets or ordinary prose", () => {
    const raw = [
      "- Plan: reviewed with patient", // bullet stays content
      "Assessment shows improvement today", // prose, no separator
      "Plant-based diet discussed", // near-miss word, no separator+space
      "No fever reported", // short multi-word line
    ].join("\n");
    expect(repairSoapStructure(raw)).toBe(raw);
  });
});

describe("normalizeNoteMarkdown", () => {
  it("turns a stray Title line into an H1 (semicolon variant included)", () => {
    expect(normalizeNoteMarkdown("Title; Cough without Chest Pain\nbody")).toBe(
      "# Cough without Chest Pain\nbody",
    );
    expect(normalizeNoteMarkdown("Title: URTI follow-up\nbody")).toBe("# URTI follow-up\nbody");
  });

  it("still strips model emphasis and doubled bullets", () => {
    expect(normalizeNoteMarkdown("- • item with **bold**")).toBe("- item with bold");
  });

  it("full salvage of the unstructured device note renders with structure and highlights", () => {
    const device =
      "Title; Cough without Chest Pain after Three Days of Fever\n" +
      "Subjectve – Patient reports mild respiratory distress two months ago";
    const out = highlightClinical(normalizeNoteMarkdown(device));
    expect(out).toContain("# Cough without Chest Pain");
    expect(out).toContain("## Subjective");
    expect(out).toContain("`respiratory distress`"); // red channel survives repair
    expect(out).toContain("*two months*"); // blue channel survives repair
  });
});

describe("hardenStreamingMarkdown", () => {
  it("closes dangling inline marks mid-stream", () => {
    expect(hardenStreamingMarkdown("note with **Temperature 37.9")).toBe(
      "note with **Temperature 37.9**",
    );
    expect(hardenStreamingMarkdown("red flag `chest pa")).toBe("red flag `chest pa`");
  });

  it("drops a trailing scaffold-only line and is a no-op on complete markdown", () => {
    expect(hardenStreamingMarkdown("## Subjective\n- fever\n##")).toBe("## Subjective\n- fever");
    const complete = "## Subjective\n- fever **38.1°C**";
    expect(hardenStreamingMarkdown(complete)).toBe(complete);
  });
});
