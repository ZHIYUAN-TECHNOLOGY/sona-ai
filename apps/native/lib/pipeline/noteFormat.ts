import type { ClinicalNote } from "@/lib/db/types";

/**
 * Reconstruct a note's Markdown from its persisted SOAP sections + orders.
 * The clinical_note table stores structured fields (not the model's original
 * Markdown), so the detail view rebuilds a clean, deterministic Markdown document
 * to render. Empty sections are omitted. Clinical highlighting is applied at
 * render time (see NoteMarkdown), not here.
 */
export function soapToMarkdown(soap: ClinicalNote["soap"], orders: ClinicalNote["orders"]): string {
  // Defensive read-path cleanup: strip any residual UNBALANCED emphasis marker that a
  // note stored before the sanitizer hardening may still carry (e.g. a dangling "**").
  // Runs before the render-time highlighter adds its own emphasis, so it only removes
  // leftover junk — a clean note is unaffected. Idempotent with stripInlineMd at write.
  const clean = (s: string) => s.replace(/\*\*/g, "").replace(/__/g, "");
  const section = (heading: string, body: string) =>
    body.trim() ? `## ${heading}\n${clean(body).trim()}\n\n` : "";

  let md =
    section("Subjective", soap.subjective) +
    section("Objective", soap.objective) +
    section("Assessment", soap.assessment) +
    section("Plan", soap.plan);

  if (orders.length > 0) {
    md += "## Orders & follow-ups\n" + orders.map((o) => `- ${clean(o.text)}`).join("\n") + "\n";
  }

  return md.trim();
}
