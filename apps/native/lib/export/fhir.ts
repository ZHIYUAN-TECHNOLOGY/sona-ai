import { SignedNote } from "./types";
import { toNoteText, base64EncodeUtf8, assertReidentified } from "./noteText";

// LOINC code for a consultation note. Standard "type" for a DocumentReference
// carrying a clinical consult note.
const LOINC_CONSULT_NOTE = {
  system: "http://loinc.org",
  code: "11488-4",
  display: "Consult note",
} as const;

// Build a FHIR R4 DocumentReference resource for a signed note, as a plain JS
// object. Standards-correct and minimal: status current, type Consult note,
// subject + author references, and the note body as a base64 text/plain
// attachment. Contained Patient/Practitioner resources keep the document
// self-describing without inventing external server IDs.
export function toFhirDocumentReference(note: SignedNote): object {
  assertReidentified(note);
  const patientRef = "#patient";
  const authorRef = "#author";
  const noteText = toNoteText(note);

  return {
    resourceType: "DocumentReference",
    status: "current",
    docStatus: "final",
    type: {
      coding: [LOINC_CONSULT_NOTE],
      text: LOINC_CONSULT_NOTE.display,
    },
    date: note.signedAtISO,
    contained: [
      {
        resourceType: "Patient",
        id: "patient",
        name: [{ text: note.patientDisplayName }],
      },
      {
        resourceType: "Practitioner",
        id: "author",
        name: [{ text: note.clinicianName }],
        identifier: [
          {
            system: "https://mmc.gov.my",
            value: note.mmcNo,
          },
        ],
      },
    ],
    subject: { reference: patientRef, display: note.patientDisplayName },
    author: [{ reference: authorRef, display: note.clinicianName }],
    description: `Consult note for ${note.patientDisplayName}`,
    identifier: [
      {
        system: "urn:sona:consult",
        value: note.consultId,
      },
    ],
    content: [
      {
        attachment: {
          contentType: "text/plain; charset=utf-8",
          data: base64EncodeUtf8(noteText),
          title: "Consult note",
          creation: note.signedAtISO,
        },
      },
    ],
  };
}
