// Demo data seeder — populates the Consults + Smart Scan lists with realistic
// synthetic rows so screens look like a working clinic on camera. EVERYTHING here
// is fictional (names, ICs, phones from the synthetic demo set — no real PHI).
// Seeded ids are tracked in the app_setting kv store so Reset removes exactly
// what Seed created and never touches real consults.

import {
  appendTranscript,
  createConsult,
  createScannedDocument,
  deleteConsult,
  deleteScannedDocument,
  getSetting,
  saveNote,
  setConsultStatus,
  setSetting,
} from "../db";
import type { ConsultStatus, VisitType } from "../db/types";

const SEED_KEY = "demo_seed_ids";

interface SeedIds {
  consults: string[];
  docs: string[];
}

interface DemoConsult {
  title: string;
  patientName: string;
  patientPhone: string;
  room: string;
  visitType: VisitType;
  status: ConsultStatus;
  /** Hours ago (createdAt offset). */
  hoursAgo: number;
  note?: { subjective: string; objective: string; assessment: string; plan: string };
}

const DEMO_CONSULTS: DemoConsult[] = [
  {
    title: "URTI follow-up",
    patientName: "Encik Rahman bin Yusof",
    patientPhone: "012-345 6789",
    room: "Room 2",
    visitType: "walk-in",
    status: "signed",
    hoursAgo: 3,
    note: {
      subjective: "Fever three days, worse at night. Productive cough with yellow sputum. No chest pain or breathlessness.",
      objective: "Temp 37.9C, throat injected, chest clear on auscultation.",
      assessment: "Upper respiratory tract infection, likely viral.",
      plan: "Symptomatic treatment. Paracetamol 1g QID PRN. Review in 3 days if fever persists.",
    },
  },
  {
    title: "Diabetes review",
    patientName: "Puan Lim Mei Ling",
    patientPhone: "017-882 3341",
    room: "Room 1",
    visitType: "appointment",
    status: "noted",
    hoursAgo: 5,
    note: {
      subjective: "Routine review. Compliant with metformin. Occasional giddiness in the morning.",
      objective: "BP 128/82, CBG 6.8 mmol/L fasting. Weight stable.",
      assessment: "Type 2 diabetes, reasonable control.",
      plan: "Continue Metformin 500mg BD. HbA1c today. Review in 3 months with results.",
    },
  },
  {
    title: "Knee pain",
    patientName: "Mr Suresh Kumar",
    patientPhone: "019-220 7745",
    room: "Room 3",
    visitType: "appointment",
    status: "noted",
    hoursAgo: 26,
    note: {
      subjective: "Right knee pain two weeks after badminton. Worse on stairs. No locking or giving way.",
      objective: "Mild effusion, tender medial joint line, full range of motion.",
      assessment: "Medial meniscal strain, mild.",
      plan: "RICE advice, avoid impact sport 2 weeks. NSAID gel — oral NSAIDs avoided (gastritis history). Review if not settling.",
    },
  },
  {
    title: "Antenatal check",
    patientName: "Puan Nurul Aisyah",
    patientPhone: "011-5566 2210",
    room: "Room 2",
    visitType: "appointment",
    status: "transcribed",
    hoursAgo: 30,
  },
];

const DEMO_DOC_TEXT = `KLINIK SEJAHTERA — Jalan Merbau 12, Taman Desa, 58100 Kuala Lumpur
Date: 10 July 2026
Re: Referral — persistent productive cough, three weeks
Current medication: Amoxicillin 500mg TDS (completed), Paracetamol 1g QID PRN, Metformin 500mg BD.
Allergy: NSAID — facial swelling.
Kindly assess for further imaging and management.`;

/** True if demo rows are currently seeded. */
export async function isDemoSeeded(): Promise<boolean> {
  return (await readSeedIds()) !== null;
}

/** Create the demo consults + scans. Idempotent: seeding twice resets first. */
export async function seedDemoData(): Promise<void> {
  await resetDemoData();
  const ids: SeedIds = { consults: [], docs: [] };
  for (const d of DEMO_CONSULTS) {
    const consult = await createConsult({
      title: d.title,
      consentText: "Saya setuju perbualan ini dirakam untuk nota klinikal.",
      patient: {
        patientName: d.patientName,
        patientPhone: d.patientPhone,
        room: d.room,
        visitType: d.visitType,
      },
    });
    ids.consults.push(consult.id);
    if (d.note) {
      await saveNote({
        consultId: consult.id,
        soap: d.note,
        orders: [],
        deidentified: false,
        edited: false,
      });
    } else {
      // A note-less draft with no transcript would be swept by pruneEmptyDrafts on
      // the next list load — anchor it with one synthetic transcript line.
      await appendTranscript({
        consultId: consult.id,
        seq: 0,
        speaker: "patient",
        text: "Sihat, cuma nak check baby punya development.",
        startMs: 0,
        endMs: 3000,
      });
    }
    await setConsultStatus(consult.id, d.status);
    await backdateConsult(consult.id, Date.now() - d.hoursAgo * 3_600_000);
  }
  const doc = await createScannedDocument({
    docType: "referral",
    title: "Referral letter (demo)",
    pages: 1,
    imageUris: [],
    rawText: DEMO_DOC_TEXT,
    redactedText: DEMO_DOC_TEXT, // synthetic — contains no identifiers to redact
    identifiers: 0,
  });
  ids.docs.push(doc.id);
  await setSetting(SEED_KEY, JSON.stringify(ids));
}

/** Delete exactly the rows the seeder created. Real consults are never touched. */
export async function resetDemoData(): Promise<void> {
  const ids = await readSeedIds();
  if (!ids) return;
  for (const id of ids.consults) await deleteConsult(id).catch(() => {});
  for (const id of ids.docs) await deleteScannedDocument(id).catch(() => {});
  await setSetting(SEED_KEY, "");
}

async function readSeedIds(): Promise<SeedIds | null> {
  try {
    const raw = await getSetting(SEED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SeedIds;
    return Array.isArray(parsed.consults) ? parsed : null;
  } catch {
    return null;
  }
}

// createdAt drives the Today/Earlier grouping — seeded rows must spread out.
async function backdateConsult(consultId: string, createdAt: number): Promise<void> {
  const { initDb } = await import("../db");
  const db = await initDb();
  await db.runAsync(`UPDATE consult SET createdAt = ?, updatedAt = ? WHERE id = ?;`, [
    createdAt,
    createdAt,
    consultId,
  ]);
}
