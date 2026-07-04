// Static mock data for the consult flow, sourced from the LOCKED demo consult
// (docs/superpowers/specs/2026-07-05-locked-demo-consult.md) — Encik Rahman, URTI,
// BM + EN. Days 2-4 replace this with real pipeline output; the shapes below map
// deliberately onto lib/db/types.ts (Consult, TranscriptSegment, ClinicalNote,
// AuditEntry) so the screens can bind to the DB with minimal change. See the
// mapping notes at the bottom of this file.

export type SpeakerKey = "dr" | "pt" | "you";

/** A run of transcript text; `bm` marks a Bahasa Malaysia span (green highlight). */
export interface TextSpan {
  text: string;
  bm?: boolean;
}

export interface DiarLine {
  speaker: SpeakerKey;
  /** Rich spans (for BM highlighting). Plain lines can pass a single span. */
  spans: TextSpan[];
  /** Renders the doctor lines in a slightly muted ink, matching the prototype. */
  faint?: boolean;
}

export type RedactionType = "name" | "ic" | "phone" | "address";

export interface RedactionChip {
  token: string; // NAME_1, IC_1, PHONE_1, ADDR_1
  type: RedactionType;
}

// --- Consult header -------------------------------------------------------

export const consult = {
  title: "GP follow-up",
  patientLabel: "Encik R. · 58 · follow-up",
  room: "Klinik Sihat, Room 2",
  clinicianName: "Dr. A. Tan",
  mmcNo: "MMC 45678",
  consentText: "Saya setuju perbualan ini dirakam untuk nota klinikal.",
  langBadge: "BM + EN → EN",
} as const;

// --- Screen 2: live diarized transcript -----------------------------------

export const liveTranscript: DiarLine[] = [
  { speaker: "dr", faint: true, spans: [{ text: "How is the cough today?" }] },
  { speaker: "pt", spans: [{ text: "Demam tiga hari, malam teruk.", bm: true }] },
  { speaker: "dr", faint: true, spans: [{ text: "Sakit dada? Any breathlessness?" }] },
  {
    speaker: "pt",
    spans: [{ text: "No. " }, { text: "Batuk berkahak kuning.", bm: true }],
  },
];

// --- Screen 3: privacy gate ------------------------------------------------

// "What the model will see" — the de-identified transcript with tokens in place.
export interface RedactedLine {
  speaker: SpeakerKey;
  faint?: boolean;
  // Ordered fragments: plain strings and redaction chips interleaved.
  parts: (string | RedactionChip)[];
}

export const redactedPreview: RedactedLine[] = [
  {
    speaker: "dr",
    faint: true,
    parts: ["Morning ", { token: "NAME_1", type: "name" }, ", cough today?"],
  },
  {
    speaker: "pt",
    parts: [
      "My IC is ",
      { token: "IC_1", type: "ic" },
      ", call ",
      { token: "PHONE_1", type: "phone" },
      ".",
    ],
  },
  {
    speaker: "dr",
    faint: true,
    parts: ["Nurse visits ", { token: "ADDR_1", type: "address" }, " Friday."],
  },
];

export const redactionCount = 4;

// The low-confidence name that must be confirmed, never auto-sent.
export const uncertainRedaction = {
  name: "Kak Timah",
  token: "NAME_UNCERTAIN_1",
  // Sentence it appears in, split around the uncertain span for inline styling.
  before: "Ask ",
  after: " to bring the card.",
  note: "Low-confidence name kept local until you decide. Never sent while unsure.",
} as const;

// Re-identify map (device-only). Only the token→real mapping is shown as proof;
// the real values are never rendered in the demo UI beyond this card.
export const reidMap: { token: string; real: string }[] = [
  { token: "NAME_1", real: "Rahman bin Ismail" },
  { token: "IC_1", real: "580214-05-5321" },
  { token: "PHONE_1", real: "012-345 6789" },
  { token: "ADDR_1", real: "No. 12, Jalan Melati, Taman Sri Muda" },
];

// --- Screen 4: consult note (SOAP + orders) --------------------------------

export const note = {
  template: "GP SOAP",
  soap: {
    subjective:
      "3 days fever, worse at night. Productive cough, yellow sputum. No chest pain. (BM history, noted in English)",
    objective: "T 38.2, HR 92, SpO₂ 97% RA. Throat erythematous, chest clear.",
    assessment: "Acute URTI, likely viral. No red flags.",
    plan: "Symptomatic care. Paracetamol 1 g QID PRN for fever. Encourage oral fluids and rest.",
  },
  orders: [
    { kind: "review", text: "Review in 1 week if fever persists." },
    { kind: "test", text: "FBC if not settling." },
    { kind: "safety-net", text: "Return immediately if significantly breathless." },
  ],
  safetyNotice: "Review before use so the note reflects the visit. You sign.",
} as const;

// --- Screen 6: audit log + proof ------------------------------------------

export interface AuditRow {
  time: string;
  detail: string;
}

export const auditLog: AuditRow[] = [
  { time: "9:42", detail: "Consent captured, spoken BM" },
  { time: "9:42", detail: "Recording started, airplane mode" },
  { time: "9:46", detail: "4 identifiers redacted on-device" },
  { time: "9:46", detail: "Note drafted, Gemma, local" },
  { time: "9:47", detail: "Signed, Dr. A. Tan" },
  { time: "9:47", detail: "Audio deleted, hash sealed" },
];

export const proof = {
  bytesLabel: "0 bytes",
  bytesSub: "of PHI transmitted, verified by the on-device network monitor.",
  duration: "4 min consult, 62s to signed note",
} as const;

// --- DB binding notes (Day 2+) ---------------------------------------------
//
// consult               -> Consult (title, consentText, status, signedAt, audioHash)
// liveTranscript[]      -> TranscriptSegment[] (speaker, text, seq, startMs/endMs, confidence)
//                          BM spans come from language-tag metadata, not stored on the row.
// redactedPreview[]     -> de-identified TranscriptSegment[] + Redaction[] (token/type/span)
// uncertainRedaction    -> a Redaction with confidence < threshold (routes to confirm UI)
// reidMap[]             -> secure-store re-ID map (../secure/reidMap.ts), never rendered raw off-device
// note                  -> ClinicalNote (soap{}, orders: NoteOrder[], deidentified=false, edited)
// auditLog[]            -> AuditEntry[] (ts, stage, detail)
// proof.bytes           -> derived from AuditEntry stage="network-check"
