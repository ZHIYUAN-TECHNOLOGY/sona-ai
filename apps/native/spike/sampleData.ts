// Spike fixtures, aligned to the LOCKED demo consult
// (docs/superpowers/specs/2026-07-05-locked-demo-consult.md).
// Gate-0 numbers are only meaningful if they measure the real demo input, so the
// LLM and redaction benches run against the locked consult, not a generic patient.
// All names / IC / phone / address are fabricated synthetic test data.

// De-identified transcript = exactly what the note model is allowed to see
// (identifiers already replaced with tokens). Benching the LLM on this means a
// GO here also predicts the Gate-3 note quality against the gold SOAP.
export const SAMPLE_TRANSCRIPT = `Follow-up consultation. Patient NAME_1, a 58 year old man, returns with a cough that has not settled. Reports fever for three days, worse at night. Productive cough with yellow sputum. Mild breathlessness when coughing hard. No chest pain. History given in Malay and English. On examination temperature is 38.2 degrees, pulse 92, oxygen saturation 97 percent on room air, throat is erythematous, chest is clear. Impression is a viral upper respiratory tract infection with no red flags. Plan is paracetamol one gram four times a day as needed for fever, oral fluids and rest. Review in one week if symptoms persist. Full blood count if the fever does not settle. Return immediately if significantly breathless.`;

// Raw text with the locked consult's identifiers, to measure redaction recall.
export const SEEDED_PII_TEXT = `Encik Rahman bin Ismail, IC 580214-05-5321, a 58 year old man, phone 012-345 6789, staying at No. 12, Jalan Melati, Taman Sri Muda, Shah Alam, returns with a persistent cough. If the nurse visits, look for Kak Timah at the house.`;

// The identifiers that must be removed. "Kak Timah" is the low-confidence name
// (surfaced for confirmation in the UI, but still masked, never silently sent).
export const SEEDED_PII_SPANS = [
  "Rahman bin Ismail",
  "580214-05-5321",
  "012-345 6789",
  "Jalan Melati",
  "Taman Sri Muda",
  "Shah Alam",
  "Kak Timah",
]; // recall = (spans removed) / spans total

export const SOAP_SYSTEM_PROMPT =
  "You are a clinical documentation assistant. Convert the de-identified consultation transcript into a concise SOAP note in English with four labelled sections: Subjective, Objective, Assessment, Plan. After Plan, add an 'Orders & follow-ups' list of any review intervals, tests ordered, and safety-net advice the clinician stated. Use only information present in the transcript. Do not invent findings, medications, or doses. Keep identifier tokens such as NAME_1 as written.";
