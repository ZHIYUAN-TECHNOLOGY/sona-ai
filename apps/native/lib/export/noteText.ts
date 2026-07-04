import { SignedNote } from "./types";

// Section headers used by both the plain-text body and the HTML. Kept in one
// place so the FHIR attachment, the PDF, and the tests all agree on wording.
export const SECTION_HEADERS = {
  subjective: "Subjective",
  objective: "Objective",
  assessment: "Assessment",
  plan: "Plan",
  orders: "Orders & follow-ups",
} as const;

// Guard the export boundary: refuse to render a note that still contains
// redaction tokens (NAME_1, IC_1, NAME_UNCERTAIN_1, …). Export happens only
// after local re-identification; a token here means the re-ID step was skipped
// and we would otherwise sign a record with placeholders instead of the patient.
const TOKEN_RE = /\b(?:NAME_UNCERTAIN|NAME|IC|PHONE|ADDR|EMAIL|DATE|MRN)_\d+/;
export function assertReidentified(note: SignedNote): void {
  const fields = [
    note.patientDisplayName,
    note.soap.subjective,
    note.soap.objective,
    note.soap.assessment,
    note.soap.plan,
    ...note.orders.map((o) => o.text),
  ];
  const hit = fields.find((f) => TOKEN_RE.test(f));
  if (hit) {
    throw new Error(
      `Refusing to export a de-identified note: redaction token found in "${hit.slice(0, 48)}". Re-identify locally before export.`,
    );
  }
}

// Flatten a signed note into a clean plain-text body. This is the canonical
// human-readable rendering embedded in the FHIR attachment.
export function toNoteText(note: SignedNote): string {
  const orders =
    note.orders.length > 0
      ? note.orders.map((o) => `- ${o.text}`).join("\n")
      : "- None.";

  return [
    "CONSULT NOTE",
    "",
    `Patient: ${note.patientDisplayName}`,
    `Clinician: ${note.clinicianName} (MMC ${note.mmcNo})`,
    `Signed: ${note.signedAtISO}`,
    `Consult ID: ${note.consultId}`,
    "",
    `${SECTION_HEADERS.subjective}:`,
    note.soap.subjective,
    "",
    `${SECTION_HEADERS.objective}:`,
    note.soap.objective,
    "",
    `${SECTION_HEADERS.assessment}:`,
    note.soap.assessment,
    "",
    `${SECTION_HEADERS.plan}:`,
    note.soap.plan,
    "",
    `${SECTION_HEADERS.orders}:`,
    orders,
    "",
  ].join("\n");
}

// Minimal, dependency-free base64 encoder for UTF-8 text. Avoids relying on
// Buffer (not in RN) or btoa (not UTF-8 safe), so the pure functions run the
// same on-device and in a plain Node test.
const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64EncodeUtf8(input: string): string {
  // Encode to UTF-8 bytes first so non-ASCII (e.g. degree sign, SpO2) survives.
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: combine with the following low surrogate.
      const hi = code;
      const lo = input.charCodeAt(++i);
      code = 0x10000 + ((hi & 0x3ff) << 10) + (lo & 0x3ff);
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }

  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += B64_CHARS[(triple >> 18) & 0x3f];
    out += B64_CHARS[(triple >> 12) & 0x3f];
    out += i + 1 < bytes.length ? B64_CHARS[(triple >> 6) & 0x3f] : "=";
    out += i + 2 < bytes.length ? B64_CHARS[triple & 0x3f] : "=";
  }
  return out;
}
