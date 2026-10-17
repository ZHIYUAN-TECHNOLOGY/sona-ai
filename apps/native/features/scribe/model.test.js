import { describe, expect, test } from "bun:test";
import { newEncounter, englishTranscript } from "@/features/encounter/fixtures";
import { advancePlayback, buildDraft, readNoteSections, serializeNoteSections } from "./model";

describe("scripted consultation", () => {
  test("reveals complete segments while preserving user corrections", () => {
    const corrected = { ...englishTranscript[0], original: "Corrected captured words", speaker: "Clinician", corrected: true };
    const result = advancePlayback({ ...newEncounter(), recording: "recording", recordingSeconds: 7, transcript: [corrected] });
    expect(result.transcript).toHaveLength(2);
    expect(result.transcript[0]).toEqual(corrected);
    expect(result.revision).toBe(2);
  });
  test("new dialogue invalidates review while retaining manual note edits", () => {
    const result = advancePlayback({ ...newEncounter(), recording: "recording", recordingSeconds: 3, note: "My preserved edits", noteReviewed: true, medicationCheckedRevision: 1 });
    expect(result.note).toBe("My preserved edits");
    expect(result.noteReviewed).toBe(false);
    expect(result.medicationCheckedRevision).toBeUndefined();
  });
  test("paused and stopped playback cannot add dialogue", () => {
    for (const recording of ["paused", "stopped"]) {
      const encounter = { ...newEncounter(), recording, recordingSeconds: 7 };
      expect(advancePlayback(encounter)).toBe(encounter);
    }
  });
  test("corrected source does not reuse an outdated English interpretation", () => {
    const draft = buildDraft([{ ...englishTranscript[1], original: "Two days only", corrected: true }]);
    expect(draft).toContain("Two days only");
    expect(draft).toContain("English interpretation needs review");
    expect(draft).not.toContain("approximately five days");
  });
  test("empty or partial transcript never adds uncaptured patient facts", () => {
    expect(buildDraft([])).toBe("");
    const draft = buildDraft([englishTranscript[0]]);
    expect(draft).not.toContain("fever started yesterday");
    expect(draft).toContain("Not captured in this transcript");
  });
  test("confirmed English interpretation replaces a stale draft without changing original dialogue", () => {
    const line = { ...englishTranscript[1], original: "Two days only", english: "Symptoms for two days.", corrected: true, englishReviewed: true };
    expect(buildDraft([line])).toContain("Symptoms for two days.");
    expect(buildDraft([line])).not.toContain("English interpretation needs review");
    expect(line.original).toBe("Two days only");
  });
  test("structured editing preserves a freeform existing note and its clinician sections", () => {
    const freeform = "My manually edited consultation";
    expect(readNoteSections(freeform).subjective).toBe(freeform);
    const sections = { subjective: freeform, objective: "Patient observations", assessment: "Clinician assessment", plan: "Clinician plan" };
    expect(readNoteSections(serializeNoteSections(sections))).toEqual(sections);
  });
  test("an unfinished plan remains empty instead of becoming authored clinical content", () => {
    expect(readNoteSections(buildDraft(englishTranscript)).plan).toBe("");
    expect(readNoteSections(buildDraft(englishTranscript)).assessment).toBe("");
    expect(readNoteSections("PLAN\nTo be completed by the clinician.").plan).toBe("");
  });
});
