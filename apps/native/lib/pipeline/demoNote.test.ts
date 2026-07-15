import { describe, expect, it } from "vitest";

import { LOCKED_DEMO_NOTE, makeDemoNoteLlm } from "./demoNote";
import { generateNote } from "./noteGen";

describe("demo note", () => {
  it("streams word-by-word and resolves with the full script", async () => {
    const ticks: string[] = [];
    const llm = makeDemoNoteLlm((acc) => ticks.push(acc));
    const out = await llm.generate([]);
    expect(out).toBe(LOCKED_DEMO_NOTE);
    expect(ticks.length).toBeGreaterThan(50); // word-level cadence, not one blob
    expect(ticks[ticks.length - 1]).toBe(LOCKED_DEMO_NOTE);
    // Monotonic accumulation — every tick extends the previous one.
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].startsWith(ticks[i - 1])).toBe(true);
  }, 30_000);

  it("parses through the real generateNote path: title, SOAP, orders, flags", async () => {
    const note = await generateNote(makeDemoNoteLlm(() => {}), []);
    expect(note.title).toBe("Productive cough with fever");
    expect(note.soap.subjective).toContain("yellow sputum");
    expect(note.soap.objective).toContain("38.2");
    expect(note.soap.assessment).toContain("Viral");
    expect(note.soap.plan).toContain("Paracetamol");
    expect(note.orders.length).toBeGreaterThanOrEqual(3);
    expect(note.redFlags).toEqual(["breathlessness"]);
    expect(note.markdown).toContain("## Subjective");
    expect(note.markdown).not.toMatch(/^title/im); // title peeled from the body
    expect(note.markdown).not.toMatch(/^flags/im); // flags peeled from the body
  }, 30_000);
});
