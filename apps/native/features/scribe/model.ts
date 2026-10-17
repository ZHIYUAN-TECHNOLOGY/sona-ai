import { englishTranscript, manglishTranscript } from "@/features/encounter/fixtures";
import { reviseEncounter } from "@/features/encounter/state";
import type { Encounter, TranscriptLine } from "@/features/encounter/types";

export function scriptFor(language: Encounter["language"]): TranscriptLine[] {
  return language === "manglish" ? manglishTranscript : englishTranscript;
}

export function advancePlayback(encounter: Encounter): Encounter {
  if (encounter.recording !== "recording") return encounter;
  const seconds = encounter.recordingSeconds + 1;
  const script = scriptFor(encounter.language);
  const available = script.slice(0, Math.min(script.length, Math.floor(seconds / 4)));
  const transcript = [...encounter.transcript];
  for (const line of available) {
    if (!transcript.some(existing => existing.id === line.id)) transcript.push({ ...line });
  }
  const next: Encounter = { ...encounter, recordingSeconds: seconds, transcript, recording: seconds >= script.length * 4 ? "stopped" : "recording" };
  return transcript.length > encounter.transcript.length ? reviseEncounter({ ...next, noteReviewed: false }) : next;
}

export function buildDraft(transcript: TranscriptLine[]): string {
  if (!transcript.length) return "";
  const captured = transcript.map(line => line.corrected && !line.englishReviewed
    ? `${line.speaker}: [Corrected original; English interpretation needs review] ${line.original}`
    : `${line.speaker}: ${line.english}`).join("\n");
  return `CONSULTATION\n${captured}\n\nOBSERVATIONS\nNot captured in this transcript.\n\nASSESSMENT\n\n\nPLAN\n`;
}

export type NoteSections = { subjective: string; objective: string; assessment: string; plan: string };
export const sectionKeys = ["subjective", "objective", "assessment", "plan"] as const;
export function readNoteSections(note: string): NoteSections {
  const sections: NoteSections = { subjective: "", objective: "", assessment: "", plan: "" };
  const chunks = note.split(/^(SUBJECTIVE|CONSULTATION|OBJECTIVE|OBSERVATIONS|ASSESSMENT|PLAN)\n/gm);
  if (chunks.length === 1) return { ...sections, subjective: note };
  sections.subjective = chunks[0]?.trim() ?? "";
  for (let index = 1; index < chunks.length; index += 2) {
    const heading = chunks[index];
    const key = heading === "CONSULTATION" || heading === "SUBJECTIVE" ? "subjective" : heading === "OBSERVATIONS" || heading === "OBJECTIVE" ? "objective" : heading === "ASSESSMENT" ? "assessment" : "plan";
    sections[key] = [sections[key], chunks[index + 1]?.trim()].filter(Boolean).join("\n");
  }
  for (const key of ["assessment", "plan"] as const) {
    if (sections[key] === "To be completed by the clinician.") sections[key] = "";
  }
  return sections;
}
export function serializeNoteSections(sections: NoteSections): string {
  return sectionKeys.map(key => `${key.toUpperCase()}\n${sections[key]}`).join("\n\n");
}
/**
 * A note edit: the draft changes and needs review again, but the encounter is not revised. The note
 * feeds none of the prescribing checks, so typing must not clear the medication review or cancel an amendment.
 */
export function editNote(encounter: Encounter, sections: NoteSections, fromSample?: boolean): Encounter {
  return { ...encounter, noteSectionDraft: sections, note: serializeNoteSections(sections), noteReviewed: false, noteSaveStatus: "idle", ...(fromSample !== undefined && { noteFromSample: fromSample }) };
}

export function elapsedLabel(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
