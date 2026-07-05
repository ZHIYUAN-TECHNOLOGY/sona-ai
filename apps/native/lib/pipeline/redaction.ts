// Deterministic, on-device PII redactor (Path B). Turns a RAW transcript into
// de-identified text with numbered tokens (NAME_1, IC_1, …), the re-identify map
// (token -> original, which stays in secure storage), the spans for the privacy
// UI, and low-confidence names surfaced for clinician confirmation.
//
// The moat lives here: only the de-identified `segments` may ever cross the device
// boundary; `reidMap` never leaves the device. This is fully on-device and has zero
// ML dependency. A production build adds a real MY name/place gazetteer + ML NER
// (Path A) on top; the token/map contract stays identical.

import type { Speaker } from "../db/types";
import type { ReidMap } from "../secure/reidMapCore";

export type PiiType = "name" | "ic" | "phone" | "email" | "address";
export type Confidence = "high" | "low";

export interface RedactionSpan {
  token: string; // NAME_1, IC_1, PHONE_1, ADDR_1, NAME_UNCERTAIN_1
  type: PiiType;
  original: string; // real value; only kept in the returned reidMap, never rendered off-device
  confidence: Confidence;
}

export interface RedactedSegment {
  speaker: Speaker;
  text: string; // de-identified: identifiers replaced with tokens
}

export interface RedactionResult {
  /** The de-identified transcript. The only thing that may leave the device. */
  segments: RedactedSegment[];
  /** token -> original. Device-only (goes to secure storage, never to SQLite/export). */
  reidMap: ReidMap;
  /** Distinct detected identifiers, for the privacy-gate UI + counts. */
  spans: RedactionSpan[];
  /** Count of high-confidence identifiers removed (the "N removed" pill). */
  highConfidenceCount: number;
  /** Low-confidence names: masked, but surfaced for "tap to confirm", never auto-sent. */
  uncertain: RedactionSpan[];
}

interface Detector {
  type: PiiType;
  confidence: Confidence;
  re: RegExp; // global; group 1 (if present) is the value to tokenize, rest kept verbatim
  keepPrefixGroup?: boolean; // when true, the match is `${group1-prefix} ${value}` and only the value is tokenized
}

// Order matters: digit/address patterns first, then honorific names, then informal
// (low-confidence) names, so a longer/structured match is never eaten by a shorter one.
const DETECTORS: Detector[] = [
  { type: "email", confidence: "high", re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { type: "ic", confidence: "high", re: /\b\d{6}-\d{2}-\d{4}\b/g },
  { type: "phone", confidence: "high", re: /\b01\d[-\s]?\d{3}[-\s]?\d{3,4}\b/g },
  {
    type: "address",
    confidence: "high",
    re: /No\.\s*\d+,\s*Jalan [^,.]+(?:,\s*Taman [^,.]+)?(?:,\s*Shah Alam|,\s*Kuala Lumpur|,\s*Petaling Jaya)?/g,
  },
  {
    // Honorific-led full name. Group 1 = honorific (kept), group 2 = the name (tokenized).
    type: "name",
    confidence: "high",
    keepPrefixGroup: true,
    re: /\b(Encik|Puan|Cik|Tuan|Datuk|Dato'|Mr|Mrs|Ms|Dr)\s+([A-Z][a-zA-Z]+(?:\s+(?:bin|binti|a\/l|a\/p)\s+[A-Z][a-zA-Z]+)*)/g,
  },
  {
    // Informal address term -> low-confidence name (surfaced for confirmation).
    type: "name",
    confidence: "low",
    re: /\b(?:Kak|Abang|Pak|Mak|Along|Angah|Adik)\s+[A-Z][a-z]+/g,
  },
];

const TOKEN_PREFIX: Record<PiiType, string> = {
  name: "NAME",
  ic: "IC",
  phone: "PHONE",
  email: "EMAIL",
  address: "ADDR",
};

export function redactTranscript(
  raw: { speaker: Speaker; text: string }[],
): RedactionResult {
  const reidMap: ReidMap = {};
  const spanByToken = new Map<string, RedactionSpan>();
  const tokenByOriginal = new Map<string, string>(); // dedup: same value -> same token
  const counters: Record<string, number> = {};

  function tokenFor(original: string, type: PiiType, confidence: Confidence): string {
    const existing = tokenByOriginal.get(original);
    if (existing) return existing;
    const base = confidence === "low" && type === "name" ? "NAME_UNCERTAIN" : TOKEN_PREFIX[type];
    counters[base] = (counters[base] ?? 0) + 1;
    const token = `${base}_${counters[base]}`;
    tokenByOriginal.set(original, token);
    reidMap[token] = original;
    spanByToken.set(token, { token, type, original, confidence });
    return token;
  }

  const segments: RedactedSegment[] = raw.map((seg) => {
    let text = seg.text;
    for (const d of DETECTORS) {
      text = text.replace(d.re, (match, ...groups) => {
        if (d.keepPrefixGroup) {
          const prefix = groups[0] as string;
          const value = groups[1] as string;
          return `${prefix} ${tokenFor(value, d.type, d.confidence)}`;
        }
        return tokenFor(match, d.type, d.confidence);
      });
    }
    return { speaker: seg.speaker, text };
  });

  const spans = [...spanByToken.values()];
  return {
    segments,
    reidMap,
    spans,
    highConfidenceCount: spans.filter((s) => s.confidence === "high").length,
    uncertain: spans.filter((s) => s.confidence === "low"),
  };
}
