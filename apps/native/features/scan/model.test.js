import { describe, expect, it } from "bun:test";
import { SAMPLE_NOTE } from "@sona-ai/domain/scan";
import { DEMO_PATIENTS } from "@sona-ai/domain/demo-patients";
import { applyLocally, countsOf, itemsOf, keptOf, replaceWord, unreadReason } from "./model";

const encounter = () => ({ revision: 1, cards: [], requests: [], note: "", noteReviewed: true, noteSections: { subjective: "Cough.", objective: "", assessment: "", plan: "Mine." }, transcript: [], recording: "idle", recordingSeconds: 0, language: "english", tasks: [] });
const amelia = DEMO_PATIENTS.find(p => p.id === "SYN-1042");

describe("scanned note review", () => {
  it("offers every item ticked and keeps only what is still ticked", () => {
    expect(itemsOf(SAMPLE_NOTE)).toEqual(["section:history", "section:examination", "section:assessment", "section:plan", "med:0", "task:0", "followUp"]);
    const kept = keptOf(SAMPLE_NOTE, new Set(["section:history", "section:examination", "section:assessment", "task:0"]));
    expect(kept).toEqual({ sections: { plan: SAMPLE_NOTE.sections.plan }, medicines: SAMPLE_NOTE.medicines, tasks: [], followUp: { in: "2 weeks" } });
    expect(countsOf(kept)).toEqual({ sections: 1, medicines: 1, tasks: 1 });
  });

  it("applies locally as a note draft, an unconfirmed medicine and tasks, never touching sections left out", () => {
    const next = applyLocally(encounter(), amelia, keptOf(SAMPLE_NOTE, new Set(["section:history"])), "From a scanned handwritten note (sample)", "scan-1");
    expect(next.noteSectionDraft.subjective).toBe("Cough.");
    expect(next.noteSectionDraft.plan).toBe(`Mine.\n${SAMPLE_NOTE.sections.plan}`);
    expect(next.noteReviewed).toBe(false);
    expect(next.medicationEntries.map(m => [m.name, m.confirmed, m.change ?? null])).toEqual([
      ["Salbutamol inhaler, as needed", false, null], ["Cetirizine, patient-reported", false, null], ["Clarithromycin 500 mg oral BD", false, "changed"],
    ]);
    expect(next.tasks.map(t => [t.id, t.title, t.owner, t.due])).toEqual([["scan-1-0", "Repeat chest X-ray and FBC", "Ward nurse", "Tomorrow"], ["scan-1-1", "Book follow-up in 2 weeks", "Attending doctor", "2 weeks"]]);
  });

  it("a corrected unsure word changes everywhere it was read", () => {
    const fixed = replaceWord(SAMPLE_NOTE, "BD", "TDS");
    expect(fixed.sections.plan).toContain("clarithromycin 500 mg TDS");
    expect(fixed.medicines[0].frequency).toBe("TDS");
    expect(fixed.sections.history).toBe(SAMPLE_NOTE.sections.history);
  });

  it("changes nothing when every item is unticked", () => {
    const start = encounter();
    expect(applyLocally(start, amelia, keptOf(SAMPLE_NOTE, new Set(itemsOf(SAMPLE_NOTE))), "x", "s")).toBe(start);
  });
});

describe("the judge build's reading", () => {
  it("shows only a model's reading: the server's stand-in is a failed read, with the wait when the model is starting", () => {
    expect(unreadReason(true, { ...SAMPLE_NOTE, source: "model", model: "medgemma" })).toBeUndefined();
    expect(unreadReason(true, { ...SAMPLE_NOTE, source: "fixture" })).toBe("No handwriting model answered, so this photo was not read");
    expect(unreadReason(true, { ...SAMPLE_NOTE, source: "fixture", waking: 2.2 })).toBe("Sona's model is starting, about 3 min. Ask again then.");
  });
  it("leaves the demo's labelled sample reading alone", () => {
    expect(unreadReason(false, { ...SAMPLE_NOTE, source: "fixture" })).toBeUndefined();
  });
});
