/**
 * The language a patient wrote in: Chinese by its characters, Malay by its common words, else English. Sona Care answers
 * in the language of the question, not the one her discharge papers were printed in (6 Oct: an English question about
 * pneumonia was answered in Malay because her leaflet was). Same rule as Sona Care's voice picker
 * (apps/care/features/assistant/voices.ts), with the words questions start with.
 */
export function languageOf(text: string): "zh" | "ms" | "en" {
  if (/[一-鿿]/.test(text)) return "zh";
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const malay = words.filter(w => /^(anda|dan|yang|untuk|ubat|hari|jika|sila|dengan|tidak|boleh|bolehkah|makan|selepas|sebelum|awak|saya|ini|itu|pada|akan|kali|sekali|lagi|datang|segera|apa|apakah|bila|bilakah|bagaimana|kenapa|mengapa|berapa|adakah|perlu|semasa|daripada|perhatikan|sakit|rasa|nak)$/.test(w)).length;
  return words.length && malay / words.length >= 0.15 ? "ms" : "en";
}
