import { DEMO_PATIENTS } from "@sona-ai/domain/demo-patients";
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
  // Minutes past the visit on a 24-hour clock: 00:30 is 45 min after 23:45; more than 12 h past reads as still ahead.
  const past = (time: string) => (((clock - (Number(time.slice(0, 2)) * 60 + Number(time.slice(3)))) % 1440) + 1440) % 1440;
  const late = patients.some(p => !started(p.id) && past(p.time) > 10 && past(p.time) <= 720);
  if (!late) return false;
  for (const p of patients) if (!started(p.id) && DEMO_SLOTS[p.id] !== undefined) p.time = demoTime(DEMO_SLOTS[p.id]!, now);
  return true;
}

export const patients: Patient[] = DEMO_PATIENTS.map(p => ({ ...structuredClone(p), time: demoTime(DEMO_SLOTS[p.id]!) }));

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


