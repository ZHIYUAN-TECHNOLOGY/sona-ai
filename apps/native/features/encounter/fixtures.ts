import type { Encounter, Patient, TranscriptLine } from "./types";

// Demo visit slots follow the clock so the schedule always reads as "upcoming", whenever the app is shown.
// ponytail: fixed offsets from app launch; real schedules come from the hospital system.
export function demoTime(offsetMinutes: number, from = new Date()) {
  const base = Math.floor((from.getHours() * 60 + from.getMinutes()) / 15) * 15 + offsetMinutes;
  const m = ((base % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const DEMO_SLOTS: Record<string, number> = { "SYN-1042": 15, "SYN-1086": 45 };
/**
 * Moves the demo visits back to "upcoming" once the first unstarted one has fallen more than
 * 10 minutes behind (e.g. the app sat open or backgrounded). Visits already under way keep their
 * time. Returns whether anything moved.
 */
export function refreshDemoTimes(started: (id: string) => boolean, now = new Date()) {
  const clock = now.getHours() * 60 + now.getMinutes();
  const late = patients.some(p => !started(p.id) && clock - (Number(p.time.slice(0, 2)) * 60 + Number(p.time.slice(3))) > 10);
  if (!late) return false;
  for (const p of patients) if (!started(p.id) && DEMO_SLOTS[p.id] !== undefined) p.time = demoTime(DEMO_SLOTS[p.id]!, now);
  return true;
}

export const patients: Patient[] = [
  { id: "SYN-1042", encounterId: "visit-1042", name: "Amelia Tan", initials: "AT", age: 42, sex: "Female", subtitle: "Respiratory review", time: demoTime(DEMO_SLOTS["SYN-1042"]!), complaint: "Cough for five days, with fever since yesterday.", history: ["Asthma since childhood", "No previous admission documented", "Symptoms began five days ago"], family: "Mother has asthma; father has type 2 diabetes.", social: "Teacher. Does not smoke. Lives with her partner and two children.", allergies: "Penicillin — reported rash; details need confirmation", medicines: ["Salbutamol inhaler, as needed", "Cetirizine, patient-reported"], vitals: [{ label: "SpO₂", value: "97%" }, { label: "Temp", value: "38.1 °C" }, { label: "Pulse", value: "96 bpm" }], incomplete: false,
    sources: [
      { id: "beta-reference", title: "DailyMed · Albuterol HFA, section 7.1", date: "Accessed 23 Sep 2026", kind: "reference", synthetic: false, url: "https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=825975b1-a4a9-78ca-e053-2a91aa0a3948", excerpt: "Label summary: beta-blockers can oppose albuterol's pulmonary effects and can cause severe bronchospasm in people with asthma. The label discusses circumstances requiring individual clinical judgement. This source supports the bounded entered-pair example and the hypothetical alert preview; applicability depends on the confirmed ingredients shown in the result." },
      { id: "pneumonia-reference", title: "NHS · Pneumonia", date: "Reviewed 17 Jul 2026 · accessed 23 Sep 2026", kind: "reference", synthetic: false, url: "https://www.nhs.uk/conditions/pneumonia/", excerpt: "Reference summary: pneumonia can involve cough, fever and breathlessness. Chest X-rays may form part of assessment. These general facts inform an authored UI example; they do not establish the fictional patient's diagnosis." },
      { id: "asthma-reference", title: "NHLBI · Asthma symptoms", date: "Updated 17 Apr 2024 · accessed 23 Sep 2026", kind: "reference", synthetic: false, url: "https://www.nhlbi.nih.gov/health/asthma/symptoms", excerpt: "Reference summary: asthma symptoms can include cough, wheeze, breathlessness and chest tightness. Other conditions can produce similar symptoms. This general source does not establish the cause of this fictional encounter." },
      { id: "history", title: "Intake & patient history", date: "22 Sep 2026 · 09:24", kind: "record", synthetic: true, excerpt: "Fictional intake: Amelia Tan, 42. Cough for five days. Fever since yesterday. Childhood asthma. Mother has asthma; father has type 2 diabetes. Teacher, never smoker. Lives with partner and two children. No previous admission documented. Reported penicillin rash. Salbutamol as needed and cetirizine reported; reconciliation incomplete." },
      { id: "vitals", title: "Observations", date: "22 Sep 2026 · 09:26", kind: "record", synthetic: true, excerpt: "Synthetic observations: oxygen saturation 97% on room air; temperature 38.1 °C; pulse 96 bpm. These are UI fixture values, not real measurements." },
      { id: "consultation", title: "Consultation transcript", date: "22 Sep 2026 · 09:30", kind: "transcript", synthetic: true, excerpt: "Scripted patient: I have been coughing for five days. The fever started yesterday. My mother has asthma. I use my blue inhaler when needed. This is authored demonstration dialogue, not a live recording." },
      { id: "medication", title: "Medication coverage note", date: "Fixture reference · v1", kind: "reference", synthetic: true, excerpt: "This prototype contains no validated drug-interaction database. Reported medicines can be reviewed in the interface; absence of a listed interaction does not establish safety. Real medicines are not automatically cleared or prescribed by these fixtures." },
      { id: "simulation", title: "Synthetic prescribing protocol", date: "Training protocol · v1", kind: "reference", synthetic: true, excerpt: "UI-only protocol: check the explicit synthetic eligibility inputs and current medication review, then automatically create an authored paracetamol regimen receipt. The receipt includes its dose, route, frequency, duration and reference. Missing inputs, unsupported medicines or stale review block this simulation. No pharmacy transmission or real clinical action occurs." },
      { id: "xray", title: "Normal PA chest radiograph · reference example", date: "Mikael Häggström · 2017 · CC0 1.0", kind: "image", synthetic: false, url: "https://commons.wikimedia.org/wiki/File:Normal_posteroanterior_(PA)_chest_radiograph_(X-ray).jpg", excerpt: "Bundled public teaching radiograph. The uploader describes a normal chest with no signs of injury. This is the source description, not model analysis or the selected fictional patient’s image. Attribution and the unmodified asset checksum are included with the application." },
    ],
  },
  { id: "SYN-1086", encounterId: "visit-1086", name: "Daniel Rahman", initials: "DR", age: 57, sex: "Male", subtitle: "History to complete", time: demoTime(DEMO_SLOTS["SYN-1086"]!), complaint: "Breathlessness on exertion; onset not yet documented.", history: ["Medical history not yet reconciled"], family: "Not documented", social: "Smoking and occupational history not documented", allergies: null, medicines: ["Patient reports a tablet; ingredient unknown"], vitals: [], incomplete: true, sources: [{ id: "history", title: "Incomplete intake", date: "22 Sep 2026 · 09:45", kind: "record", synthetic: true, excerpt: "Fictional intake: Daniel Rahman, 57. Breathlessness on exertion; onset, observations, allergy details, medicines and family/social history are not yet documented. Do not interpret missing data as negative findings." }, { id: "medication", title: "Medication coverage note", date: "Fixture reference · v1", kind: "reference", synthetic: true, excerpt: "Ingredient unknown. Interaction evaluation unavailable. No validated interaction database is connected." }],
  },
];

export const englishTranscript: TranscriptLine[] = [
  { id: "l1", speaker: "Speaker 1", original: "How long have you had the cough?", english: "How long have you had the cough?" },
  { id: "l2", speaker: "Speaker 2", original: "About five days. I started having a fever yesterday.", english: "Cough for approximately five days; fever started yesterday." },
  { id: "l3", speaker: "Speaker 2", original: "My mum has asthma too. I use the blue inhaler when I need it.", english: "Family history of maternal asthma. Reports using a reliever inhaler as needed; ingredient requires reconciliation." },
];
export const manglishTranscript: TranscriptLine[] = [
  { id: "m1", speaker: "Speaker 1", original: "Batuk sudah berapa hari? Any fever?", english: "How many days have you had the cough? Any fever?" },
  { id: "m2", speaker: "Speaker 2", original: "Five days already, 昨天开始发烧. Malam batuk lagi teruk.", english: "Cough for five days. Fever began yesterday. Cough is worse at night." },
  { id: "m3", speaker: "Speaker 2", original: "Mak saya ada asthma juga. Blue inhaler tu, I pakai bila perlu.", english: "Mother also has asthma. Reports using a blue inhaler as needed; ingredient requires confirmation." },
];
export function newEncounter(): Encounter { return { revision: 1, cards: [], requests: [], note: "", noteReviewed: false, transcript: [], recording: "idle", recordingSeconds: 0, language: "english", tasks: [] }; }

for (const patient of patients) patient.sources.push({ id: "paracetamol-reference", title: "NHS · Paracetamol for adults", date: "Reviewed 24 Mar 2026 · accessed 23 Sep 2026", kind: "reference", synthetic: false, url: "https://www.nhs.uk/medicines/paracetamol-for-adults/", excerpt: "Reference summary: adult 500 mg tablets are taken one or two at a time, at least four hours apart, no more than eight in 24 hours and for no more than three days without medical advice. Lower weight, prior allergy, kidney/liver conditions, alcohol risk and other medicines require consideration. The prototype's narrower 500 mg every six hours as-needed example is an authored synthetic regimen, not an NHS recommendation for this fictional patient. Interaction lookup outcomes are simulated and do not establish clinical safety." });

const interactionReference = patients[0].sources.find(source => source.id === "beta-reference")!;
for (const patient of patients.slice(1)) patient.sources.push({ ...interactionReference });
