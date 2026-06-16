// A pre-written de-identified transcript used to benchmark the LLM in isolation
// (so STT variance doesn't pollute LLM timing). ~500 words.
export const SAMPLE_TRANSCRIPT = `Patient is a 34 year old presenting with a three day history of fever, dry cough, and sore throat that is worse on swallowing. Reports temperature measured at home around 38.5 degrees. No shortness of breath, no chest pain. Denies recent travel. Has mild headache and body aches. No known drug allergies. Currently taking paracetamol as needed with partial relief. On examination throat is mildly erythematous, no exudate, chest clear on auscultation, oxygen saturation 98 percent on room air. Working impression is a viral upper respiratory tract infection. Plan is supportive care, paracetamol for fever, adequate hydration and rest, and to return if breathing difficulty, persistent high fever beyond five days, or worsening symptoms.`;

// The same kind of text with 10 PII spans seeded, to measure redaction recall.
export const SEEDED_PII_TEXT = `Ahmad bin Hassan, IC 880101-14-5523, a 34 year old from Petaling Jaya, phone 012-3456789, email ahmad.h@example.com, seen on 14 June 2026 by Dr Lim Wei Sheng at Klinik Sihat presents with fever and sore throat. Next of kin Siti Aminah, contactable at 019-8765432.`;

export const SEEDED_PII_SPANS = [
  "Ahmad bin Hassan",
  "880101-14-5523",
  "Petaling Jaya",
  "012-3456789",
  "ahmad.h@example.com",
  "14 June 2026",
  "Dr Lim Wei Sheng",
  "Klinik Sihat",
  "Siti Aminah",
  "019-8765432",
]; // 10 spans; recall = (spans removed) / 10

export const SOAP_SYSTEM_PROMPT =
  "You are a clinical documentation assistant. Convert the consultation transcript into a concise SOAP note with four labelled sections: Subjective, Objective, Assessment, Plan. Use only information present in the transcript. Do not invent findings, medications, or doses.";
