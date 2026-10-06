import type { Tone } from "@/components/primitives";

export type Label = "urgent" | "clinical" | "admin";

/** Red must-not-miss, amber soon; admin carries no colour. */
export const labelTone = (label: Label | null): Tone | "neutral" =>
  label === "urgent" ? "urgent" : label === "clinical" ? "soon" : "neutral";

/** Who gave a message its triage label, in the phone app's words. */
export function triageBy(by: { source: string; decidedBy?: string } | undefined) {
  if (!by || by.source === "none") return "Triage did not run · read it first";
  if (by.source === "model") return by.decidedBy === "rules" ? "Triaged by the safety rules" : "Triaged by Sona";
  if (by.source === "fixture") return "Triaged by rules";
  return "Triage source not recorded";
}

/** "5 min", "3 h", "2 d" since `at`. */
export function ago(at: Date | string, now: Date | string = new Date()) {
  const min = Math.max(0, Math.round((new Date(now).getTime() - new Date(at).getTime()) / 60000));
  return min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`;
}

export const clock = (at: Date | string) =>
  new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
