// Linguistic role classifier — scores whether an utterance sounds like the DOCTOR
// (asks, examines, instructs, orders, quotes vitals) or the PATIENT (first-person
// symptom report). Bilingual: English + Malay (BM), matching the code-switched consult.
// Voice-independent, so it labels clusters even with no enrolled voiceprint, and breaks
// ties when acoustics are ambiguous. Pure + deterministic; no PHI leaves the device.

export interface RoleScore {
  doctor: number;
  patient: number;
}

interface Cue {
  re: RegExp;
  w: number;
}

// Doctor cues: clinical instructions, examination, orders, vitals, second-person questions.
const DOCTOR_CUES: Cue[] = [
  { re: /\b(examine|prescrib\w*|diagnos\w*|refer|admit|review in|follow[-\s]?up|come back if)\b/i, w: 3 },
  { re: /\b(let me (confirm|check|listen|examine)|i(?:'ll| will) (prescribe|order|refer))\b/i, w: 3 },
  { re: /\b(temperature|pulse|oxygen|blood pressure|bp|throat|chest clear|fbc|full blood count)\b/i, w: 2.5 },
  { re: /\b\d+\s?(mg|milligram|gram|mcg|ml)\b/i, w: 2 }, // dose given
  { re: /\b(any|is there|do you have|how(?:'s| is)|when did)\b.*\?/i, w: 1.5 }, // clinician question
  { re: /\b(paracetamol|antibiotic|amoxicillin|ibuprofen|four times a day|twice daily|once daily)\b/i, w: 2 },
  // Malay clinician cues
  { re: /\b(ambil ubat|makan ubat|rujuk|kena|patut|jangan|elak|kawal)\b/i, w: 2.5 },
  { re: /\b(berapa lama|bila|ada tak|sakit\s+\w+\s*\?)\b/i, w: 1.5 }, // BM question / probe
  { re: /\b(demam turun|periksa|tekanan darah|suhu badan)\b/i, w: 2 },
];

// Patient cues: first-person symptom description.
const PATIENT_CUES: Cue[] = [
  { re: /\b(i (feel|have|get|had|been|am)|my (chest|head|throat|stomach|back)|it hurts|since (yesterday|last))\b/i, w: 3 },
  { re: /\b(no chest pain|just the cough|still (there|have)|getting worse|feel better)\b/i, w: 2 },
  { re: /\b(yes,? (betul|doktor)|betul\b)\b/i, w: 1.5 }, // patient confirming
  // Malay patient cues (symptom-first person)
  { re: /\b(saya (rasa|ada|dah|kena)|sakit|demam|batuk|sesak|penat|pening|loya|muntah)\b/i, w: 3 },
  { re: /\b(masih ada|dah (tiga|dua|empat)? ?hari|malam lagi teruk|sejak|makin teruk|warna kuning)\b/i, w: 2.5 },
  { re: /\b(berkahak|kahak|selsema|tak boleh tidur)\b/i, w: 2 },
];

function score(text: string, cues: Cue[]): number {
  let s = 0;
  for (const c of cues) if (c.re.test(text)) s += c.w;
  return s;
}

/** Role score for one utterance. Both zero → neutral (no cue matched). */
export function scoreUtteranceRole(text: string): RoleScore {
  return { doctor: score(text, DOCTOR_CUES), patient: score(text, PATIENT_CUES) };
}

/** Aggregate role score over all utterances in a cluster. */
export function scoreClusterRole(texts: string[]): RoleScore {
  return texts.reduce<RoleScore>(
    (acc, t) => {
      const s = scoreUtteranceRole(t);
      acc.doctor += s.doctor;
      acc.patient += s.patient;
      return acc;
    },
    { doctor: 0, patient: 0 },
  );
}
