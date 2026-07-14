// Local, on-device SQLite persistence for the Sona scribe.
//
// Stores consult / transcript / note / audit rows. Everything here is device-local;
// nothing is ever transmitted. The re-identify map (token → real value) is NOT
// stored here — it lives in secure storage (../secure/reidMap.ts) per the moat rule.
//
// DEP TO ADD: `expo-sqlite` (NOT yet in package.json). Do not run install here.
//   expo install expo-sqlite
//
// expo-sqlite needs the native module, so anything in this file requires a real
// device / simulator build to execute. The pure builders below (buildConsult,
// buildAudit, …) are unit-testable without the native module — see db.test.ts.

import * as SQLite from "expo-sqlite";
import * as Crypto from "expo-crypto";

import type { SearchDoc } from "../search/noteSearch";
import {
  buildAudit,
  buildConsult,
  buildScannedDocument,
  buildTranscriptSegment,
} from "./builders";
import type {
  AuditEntry,
  AuditStage,
  ClinicalNote,
  Consult,
  ConsultStatus,
  NoteOrder,
  PatientDetails,
  ScannedDocStatus,
  ScannedDocument,
  Speaker,
  TranscriptSegment,
} from "./types";

const DB_NAME = "sona.db";

/** Schema version — bump + add a migration branch in initDb when the schema changes. */
const SCHEMA_VERSION = 6;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** A v4 id. Uses expo-crypto's UUID; falls back to random hex if unavailable. */
function newId(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

// Pure row builders live in ./builders (native-free, unit-testable). Re-exported
// here so the whole persistence API is importable from "lib/db".
export {
  buildAudit,
  buildConsult,
  buildScannedDocument,
  buildTranscriptSegment,
} from "./builders";

// --- Schema ------------------------------------------------------------------

const SCHEMA_SQL = `
-- patientName/patientPhone/room/visitType (v6) are optional patient context shown
-- on the consult card. DEVICE-ONLY PHI, same posture as transcript_segment.text:
-- never fed to the model, never exported, never transmitted.
CREATE TABLE IF NOT EXISTS consult (
  id            TEXT PRIMARY KEY NOT NULL,
  createdAt     INTEGER NOT NULL,
  updatedAt     INTEGER NOT NULL,
  status        TEXT NOT NULL,
  title         TEXT NOT NULL,
  consentText   TEXT NOT NULL,
  patientName   TEXT,
  patientPhone  TEXT,
  room          TEXT,
  visitType     TEXT,
  audioHash     TEXT,
  signedAt      INTEGER
);

-- HARDENING TODO (post-demo, not the moat): transcript_segment.text holds the
-- RAW pre-redaction transcript (full PII) in plaintext SQLite. The moat holds
-- (nothing leaves the device), but at-rest this should be encrypted — SQLCipher
-- with a key in SecureStore, or keep only de-identified text in SQLite and the
-- raw transcript in secure storage. Tracked in the build plan's risks.
CREATE TABLE IF NOT EXISTS transcript_segment (
  id          TEXT PRIMARY KEY NOT NULL,
  consultId   TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  speaker     TEXT NOT NULL,
  text        TEXT NOT NULL,
  startMs     INTEGER NOT NULL,
  endMs       INTEGER NOT NULL,
  confidence  REAL,
  FOREIGN KEY (consultId) REFERENCES consult(id)
);
CREATE INDEX IF NOT EXISTS idx_transcript_consult ON transcript_segment(consultId, seq);

CREATE TABLE IF NOT EXISTS clinical_note (
  id            TEXT PRIMARY KEY NOT NULL,
  consultId     TEXT NOT NULL,
  createdAt     INTEGER NOT NULL,
  updatedAt     INTEGER NOT NULL,
  subjective    TEXT NOT NULL,
  objective     TEXT NOT NULL,
  assessment    TEXT NOT NULL,
  plan          TEXT NOT NULL,
  orders        TEXT NOT NULL,   -- JSON-encoded NoteOrder[]
  redFlags      TEXT NOT NULL DEFAULT '[]',  -- JSON-encoded string[] (hybrid highlighter)
  deidentified  INTEGER NOT NULL,
  edited        INTEGER NOT NULL,
  FOREIGN KEY (consultId) REFERENCES consult(id),
  UNIQUE (consultId)             -- one note per consult; makes INSERT OR REPLACE a true upsert
);
CREATE INDEX IF NOT EXISTS idx_note_consult ON clinical_note(consultId);

CREATE TABLE IF NOT EXISTS audit_entry (
  id          TEXT PRIMARY KEY NOT NULL,
  consultId   TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  stage       TEXT NOT NULL,
  detail      TEXT NOT NULL,
  FOREIGN KEY (consultId) REFERENCES consult(id)
);
CREATE INDEX IF NOT EXISTS idx_audit_consult ON audit_entry(consultId, ts);

-- On-device embedding cache for semantic note search. Vectors are computed locally
-- (executorch MiniLM) from the note text and stored ONLY on-device — like everything
-- else, they never leave the phone. Keyed per consult; the model column invalidates
-- the cache if the embedding model changes. New TABLE via IF NOT EXISTS auto-creates on
-- DBs, so no ALTER migration is needed for v3.
CREATE TABLE IF NOT EXISTS note_embedding (
  consultId  TEXT PRIMARY KEY NOT NULL,
  vec        TEXT NOT NULL,   -- JSON-encoded number[] (embedding vector)
  model      TEXT NOT NULL,   -- embedding model name (cache key)
  updatedAt  INTEGER NOT NULL,
  FOREIGN KEY (consultId) REFERENCES consult(id)
);

-- Scanned paper documents (Smart Scan, v5). rawText + imageUris are device-only PHI
-- (same posture as transcript_segment.text — see the HARDENING TODO above); only
-- redactedText/summary may ever cross the boundary. consultId is NULL for standalone
-- document notes and set on attach; page images are deleted when the linked consult
-- signs (mirrors audio-discard) or when a standalone note is saved. New TABLE via
-- IF NOT EXISTS auto-creates on existing DBs, so no ALTER migration is needed.
CREATE TABLE IF NOT EXISTS scanned_document (
  id            TEXT PRIMARY KEY NOT NULL,
  createdAt     INTEGER NOT NULL,
  updatedAt     INTEGER NOT NULL,
  consultId     TEXT,
  title         TEXT NOT NULL,
  docType       TEXT NOT NULL,
  pages         INTEGER NOT NULL,
  imageUris     TEXT NOT NULL,   -- JSON-encoded string[] (local file URIs)
  rawText       TEXT NOT NULL,
  redactedText  TEXT NOT NULL,
  identifiers   INTEGER NOT NULL,
  summary       TEXT,
  status        TEXT NOT NULL,
  FOREIGN KEY (consultId) REFERENCES consult(id)
);
CREATE INDEX IF NOT EXISTS idx_doc_consult ON scanned_document(consultId);

-- Tiny on-device key/value store for user preferences (clinician profile, …).
-- Never synced, never exported. New TABLE via IF NOT EXISTS — no migration needed.
CREATE TABLE IF NOT EXISTS app_setting (
  key    TEXT PRIMARY KEY NOT NULL,
  value  TEXT NOT NULL
);

-- Enrolled clinician voiceprint for speaker diarization (v4). A single row (id='self')
-- holds the doctor's speaker embedding so the diarizer can label which voice is the
-- clinician. BIOMETRIC PHI: this is device-only like the re-ID map — it is never logged,
-- exported, or transmitted. The model column invalidates it if the embedder changes.
-- New TABLE via IF NOT EXISTS auto-creates on existing DBs, so no ALTER migration needed.
CREATE TABLE IF NOT EXISTS doctor_voiceprint (
  id         TEXT PRIMARY KEY NOT NULL,   -- always 'self' (singleton)
  vec        TEXT NOT NULL,   -- JSON-encoded number[] (unit-normalized voiceprint)
  model      TEXT NOT NULL,   -- embedder id (cache key)
  updatedAt  INTEGER NOT NULL
);
`;

/**
 * Open (once) and initialise the local database. Idempotent — safe to call on
 * every app start. Requires the native module, so this only runs on device.
 */
export async function initDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync("PRAGMA journal_mode = WAL;");
      await db.execAsync("PRAGMA foreign_keys = ON;");
      await db.execAsync(SCHEMA_SQL);
      // Migrations for DBs created before the current SCHEMA_VERSION. CREATE TABLE
      // IF NOT EXISTS above is a no-op on an existing DB, so pre-existing tables must
      // be ALTER-ed here. Each branch is idempotent (guarded by the stored version).
      const { user_version: v = 0 } =
        (await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version;")) ?? {};
      if (v < 2) {
        // v2: add clinical_note.redFlags (hybrid highlighter). Wrapped — the column
        // already exists on fresh DBs from SCHEMA_SQL, so ignore the duplicate error.
        try {
          await db.execAsync("ALTER TABLE clinical_note ADD COLUMN redFlags TEXT NOT NULL DEFAULT '[]';");
        } catch {
          // column already present (fresh DB) — nothing to migrate
        }
      }
      if (v < 6) {
        // v6: optional patient context on the consult card (device-only PHI).
        for (const col of ["patientName", "patientPhone", "room", "visitType"]) {
          try {
            await db.execAsync(`ALTER TABLE consult ADD COLUMN ${col} TEXT;`);
          } catch {
            // column already present (fresh DB) — nothing to migrate
          }
        }
      }
      await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
      return db;
    })();
  }
  return dbPromise;
}

/** Reset the cached handle (tests / teardown). Does not delete data. */
export function _resetDbHandle(): void {
  dbPromise = null;
}

// --- Settings kv ---------------------------------------------------------------

/** Read one app setting, or null. Device-only preferences (see app_setting table). */
export async function getSetting(key: string): Promise<string | null> {
  const db = await initDb();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_setting WHERE key = ? LIMIT 1;`,
    [key],
  );
  return row?.value ?? null;
}

/** Upsert one app setting. */
export async function setSetting(key: string, value: string): Promise<void> {
  const db = await initDb();
  await db.runAsync(`INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?);`, [key, value]);
}

// --- CRUD --------------------------------------------------------------------

/** Create a new consult (status "consented") and persist it. Returns the row. */
export async function createConsult(input: {
  title: string;
  consentText: string;
  patient?: Partial<PatientDetails>;
}): Promise<Consult> {
  const db = await initDb();
  const consult = buildConsult({ ...input, id: newId() });
  await db.runAsync(
    `INSERT INTO consult (id, createdAt, updatedAt, status, title, consentText,
                          patientName, patientPhone, room, visitType, audioHash, signedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      consult.id,
      consult.createdAt,
      consult.updatedAt,
      consult.status,
      consult.title,
      consult.consentText,
      consult.patientName,
      consult.patientPhone,
      consult.room,
      consult.visitType,
      consult.audioHash,
      consult.signedAt,
    ],
  );
  return consult;
}

/** Update a consult's status (and bump updatedAt). */
export async function setConsultStatus(
  consultId: string,
  status: ConsultStatus,
): Promise<void> {
  const db = await initDb();
  await db.runAsync(`UPDATE consult SET status = ?, updatedAt = ? WHERE id = ?;`, [
    status,
    Date.now(),
    consultId,
  ]);
}

/** Append one transcript segment. Returns the stored row. */
export async function appendTranscript(input: {
  consultId: string;
  seq: number;
  speaker: Speaker;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number | null;
}): Promise<TranscriptSegment> {
  const db = await initDb();
  const seg = buildTranscriptSegment({ ...input, id: newId() });
  await db.runAsync(
    `INSERT INTO transcript_segment (id, consultId, seq, speaker, text, startMs, endMs, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [seg.id, seg.consultId, seg.seq, seg.speaker, seg.text, seg.startMs, seg.endMs, seg.confidence],
  );
  return seg;
}

/** Read all transcript segments for a consult, ordered by seq. */
export async function getTranscript(consultId: string): Promise<TranscriptSegment[]> {
  const db = await initDb();
  return db.getAllAsync<TranscriptSegment>(
    `SELECT id, consultId, seq, speaker, text, startMs, endMs, confidence
     FROM transcript_segment WHERE consultId = ? ORDER BY seq ASC;`,
    [consultId],
  );
}

/**
 * Insert or replace the note for a consult (one note per consult in the demo).
 * `orders` is JSON-encoded for storage and decoded on read.
 */
export async function saveNote(input: {
  consultId: string;
  soap: ClinicalNote["soap"];
  orders: NoteOrder[];
  redFlags?: string[];
  deidentified: boolean;
  edited?: boolean;
  id?: string;
}): Promise<ClinicalNote> {
  const db = await initDb();
  const now = Date.now();
  const existing = await getNote(input.consultId);
  const note: ClinicalNote = {
    id: input.id ?? existing?.id ?? newId(),
    consultId: input.consultId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    soap: input.soap,
    orders: input.orders,
    redFlags: input.redFlags ?? existing?.redFlags ?? [],
    deidentified: input.deidentified,
    edited: input.edited ?? existing?.edited ?? false,
  };
  await db.runAsync(
    `INSERT OR REPLACE INTO clinical_note
       (id, consultId, createdAt, updatedAt, subjective, objective, assessment, plan, orders, redFlags, deidentified, edited)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      note.id,
      note.consultId,
      note.createdAt,
      note.updatedAt,
      note.soap.subjective,
      note.soap.objective,
      note.soap.assessment,
      note.soap.plan,
      JSON.stringify(note.orders),
      JSON.stringify(note.redFlags),
      note.deidentified ? 1 : 0,
      note.edited ? 1 : 0,
    ],
  );
  // Invalidate the cached semantic-search embedding: the note text just changed, so its
  // stored vector is stale. Backfill re-embeds it on the next search.
  await db.runAsync(`DELETE FROM note_embedding WHERE consultId = ?;`, [input.consultId]);
  return note;
}

interface NoteRow {
  id: string;
  consultId: string;
  createdAt: number;
  updatedAt: number;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  orders: string;
  redFlags: string | null;
  deidentified: number;
  edited: number;
}

/** Read the note for a consult, or null if none saved yet. */
export async function getNote(consultId: string): Promise<ClinicalNote | null> {
  const db = await initDb();
  const row = await db.getFirstAsync<NoteRow>(
    `SELECT id, consultId, createdAt, updatedAt, subjective, objective, assessment, plan, orders, redFlags, deidentified, edited
     FROM clinical_note WHERE consultId = ? ORDER BY updatedAt DESC LIMIT 1;`,
    [consultId],
  );
  if (!row) return null;
  return {
    id: row.id,
    consultId: row.consultId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    soap: {
      subjective: row.subjective,
      objective: row.objective,
      assessment: row.assessment,
      plan: row.plan,
    },
    orders: JSON.parse(row.orders) as NoteOrder[],
    redFlags: row.redFlags ? (JSON.parse(row.redFlags) as string[]) : [],
    deidentified: row.deidentified === 1,
    edited: row.edited === 1,
  };
}

/** Append one append-only audit row. Returns the stored row. */
export async function appendAudit(input: {
  consultId: string;
  stage: AuditStage;
  detail: string;
}): Promise<AuditEntry> {
  const db = await initDb();
  const entry = buildAudit({ ...input, id: newId() });
  await db.runAsync(
    `INSERT INTO audit_entry (id, consultId, ts, stage, detail) VALUES (?, ?, ?, ?, ?);`,
    [entry.id, entry.consultId, entry.ts, entry.stage, entry.detail],
  );
  return entry;
}

/** Read the audit log for a consult, oldest first. */
export async function getAudit(consultId: string): Promise<AuditEntry[]> {
  const db = await initDb();
  return db.getAllAsync<AuditEntry>(
    `SELECT id, consultId, ts, stage, detail FROM audit_entry WHERE consultId = ? ORDER BY ts ASC;`,
    [consultId],
  );
}

/** Seal the audio hash and signed timestamp onto a consult (called on sign). */
export async function sealConsultAudio(
  consultId: string,
  audioHash: string,
  signedAt = Date.now(),
): Promise<void> {
  const db = await initDb();
  await db.runAsync(
    `UPDATE consult SET audioHash = ?, signedAt = ?, status = 'signed', updatedAt = ? WHERE id = ?;`,
    [audioHash, signedAt, Date.now(), consultId],
  );
}

/** Read a single consult by id, or null. */
export async function getConsult(consultId: string): Promise<Consult | null> {
  const db = await initDb();
  const row = await db.getFirstAsync<Consult>(
    `SELECT ${CONSULT_COLS} FROM consult WHERE id = ? LIMIT 1;`,
    [consultId],
  );
  return row ?? null;
}

/** Set/replace a consult's patient context (device-only PHI — see the schema note). */
export async function setConsultPatient(
  consultId: string,
  patient: PatientDetails,
): Promise<void> {
  const db = await initDb();
  await db.runAsync(
    `UPDATE consult SET patientName = ?, patientPhone = ?, room = ?, visitType = ?, updatedAt = ?
     WHERE id = ?;`,
    [
      patient.patientName?.trim() || null,
      patient.patientPhone?.trim() || null,
      patient.room?.trim() || null,
      patient.visitType,
      Date.now(),
      consultId,
    ],
  );
}

/** Rename a consult (AI-generated title, or a clinician edit). Title must be PII-free. */
export async function setConsultTitle(consultId: string, title: string): Promise<void> {
  const db = await initDb();
  await db.runAsync(`UPDATE consult SET title = ?, updatedAt = ? WHERE id = ?;`, [
    title,
    Date.now(),
    consultId,
  ]);
}

/** Permanently delete a consult and all its child rows (transcript, note, audit).
 *  On-device only; wipes the raw transcript too. Wrapped in a transaction. */
export async function deleteConsult(consultId: string): Promise<void> {
  const db = await initDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM transcript_segment WHERE consultId = ?;`, [consultId]);
    await db.runAsync(`DELETE FROM clinical_note WHERE consultId = ?;`, [consultId]);
    await db.runAsync(`DELETE FROM audit_entry WHERE consultId = ?;`, [consultId]);
    await db.runAsync(`DELETE FROM note_embedding WHERE consultId = ?;`, [consultId]);
    // Detach (don't delete) scanned documents — the scan itself remains in Smart Scan.
    await db.runAsync(
      `UPDATE scanned_document SET consultId = NULL, status = 'saved' WHERE consultId = ?;`,
      [consultId],
    );
    await db.runAsync(`DELETE FROM consult WHERE id = ?;`, [consultId]);
  });
}

/** Delete abandoned empty drafts: consults still in a pre-note state that never
 *  captured any transcript AND never produced a note. Clears the junk left when a
 *  consult is started (row created at consent) then abandoned. Returns the count.
 *  Safe: anything with transcript or a note is kept; the active in-flow consult is
 *  never on a tab list when this runs. */
export async function pruneEmptyDrafts(): Promise<number> {
  const db = await initDb();
  let count = 0;
  await db.withTransactionAsync(async () => {
    const drafts = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM consult
         WHERE status IN ('consented','recording','transcribed','redacted')
           AND id NOT IN (SELECT DISTINCT consultId FROM transcript_segment)
           AND id NOT IN (SELECT DISTINCT consultId FROM clinical_note);`,
    );
    // Delete child rows FIRST — the FKs have no ON DELETE CASCADE, so deleting a consult
    // that still has audit_entry (every draft has consent/record-start audits) would fail
    // "FOREIGN KEY constraint failed". Mirror deleteConsult's child order.
    for (const d of drafts) {
      await db.runAsync(`DELETE FROM audit_entry WHERE consultId = ?;`, [d.id]);
      await db.runAsync(`DELETE FROM note_embedding WHERE consultId = ?;`, [d.id]);
      await db.runAsync(`DELETE FROM transcript_segment WHERE consultId = ?;`, [d.id]);
      // Detach scanned docs (FK) — the scan survives in Smart Scan as a standalone doc.
      await db.runAsync(
        `UPDATE scanned_document SET consultId = NULL, status = 'saved' WHERE consultId = ?;`,
        [d.id],
      );
      await db.runAsync(`DELETE FROM consult WHERE id = ?;`, [d.id]);
    }
    count = drafts.length;
  });
  return count;
}

const CONSULT_COLS =
  "id, createdAt, updatedAt, status, title, consentText, patientName, patientPhone, room, visitType, audioHash, signedAt";

/** A consult row for list screens, with a one-line note preview when a note exists. */
export interface ConsultListItem extends Consult {
  snippet: string | null;
}

/** All consults, newest first — powers the Today / History tab lists. */
export async function listConsults(): Promise<ConsultListItem[]> {
  const db = await initDb();
  const cols = CONSULT_COLS.split(", ").map((c) => `c.${c}`).join(", ");
  return db.getAllAsync<ConsultListItem>(
    `SELECT ${cols}, substr(n.subjective, 1, 120) AS snippet
     FROM consult c LEFT JOIN clinical_note n ON n.consultId = c.id
     ORDER BY c.createdAt DESC;`,
  );
}

/** Consults that have reached a note stage — powers the Notes tab. */
export async function listNotedConsults(): Promise<Consult[]> {
  const db = await initDb();
  return db.getAllAsync<Consult>(
    `SELECT ${CONSULT_COLS} FROM consult
     WHERE status IN ('noted','signed','complete') ORDER BY createdAt DESC;`,
  );
}

interface SearchRow {
  consultId: string;
  title: string;
  status: string;
  createdAt: number;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  orders: string;
}

/**
 * Load every noted consult as a searchable doc (title + SOAP body + order text),
 * for the on-device note search. Reads locally only — the notes never leave the
 * device, so searching them is inside the moat.
 */
export async function getSearchDocs(): Promise<SearchDoc[]> {
  const db = await initDb();
  const rows = await db.getAllAsync<SearchRow>(
    `SELECT c.id AS consultId, c.title AS title, c.status AS status, c.createdAt AS createdAt,
            n.subjective, n.objective, n.assessment, n.plan, n.orders
     FROM consult c JOIN clinical_note n ON n.consultId = c.id
     ORDER BY c.createdAt DESC;`,
  );
  return rows.map((r) => {
    let orderText = "";
    try {
      orderText = (JSON.parse(r.orders) as NoteOrder[]).map((o) => o.text).join(" ");
    } catch {
      orderText = "";
    }
    const text = [r.subjective, r.objective, r.assessment, r.plan, orderText]
      .filter((s) => s && s.trim())
      .join(" ");
    return { consultId: r.consultId, title: r.title, status: r.status, createdAt: r.createdAt, text };
  });
}

/**
 * Upsert the embedding vector for a consult's note (semantic-search cache). Stored
 * on-device only; `model` lets a later model change invalidate stale vectors.
 */
export async function saveNoteEmbedding(
  consultId: string,
  model: string,
  vec: number[],
): Promise<void> {
  const db = await initDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO note_embedding (consultId, vec, model, updatedAt) VALUES (?, ?, ?, ?);`,
    [consultId, JSON.stringify(vec), model, Date.now()],
  );
}

interface EmbRow {
  consultId: string;
  vec: string;
}

/** All cached note embeddings for a given embedding model. */
export async function getNoteEmbeddings(
  model: string,
): Promise<{ consultId: string; vec: number[] }[]> {
  const db = await initDb();
  const rows = await db.getAllAsync<EmbRow>(
    `SELECT consultId, vec FROM note_embedding WHERE model = ?;`,
    [model],
  );
  return rows.map((r) => ({ consultId: r.consultId, vec: JSON.parse(r.vec) as number[] }));
}

// --- Scanned documents (Smart Scan) -------------------------------------------

interface DocRow {
  id: string;
  createdAt: number;
  updatedAt: number;
  consultId: string | null;
  title: string;
  docType: string;
  pages: number;
  imageUris: string;
  rawText: string;
  redactedText: string;
  identifiers: number;
  summary: string | null;
  status: string;
}

function docFromRow(row: DocRow): ScannedDocument {
  let imageUris: string[] = [];
  try {
    imageUris = JSON.parse(row.imageUris) as string[];
  } catch {
    imageUris = [];
  }
  return { ...row, imageUris, status: row.status as ScannedDocStatus };
}

const DOC_COLS =
  "id, createdAt, updatedAt, consultId, title, docType, pages, imageUris, rawText, redactedText, identifiers, summary, status";

/** Persist a freshly scanned document (status "review"). Returns the row. */
export async function createScannedDocument(input: {
  docType: string;
  title: string;
  pages: number;
  imageUris: string[];
  rawText: string;
  redactedText: string;
  identifiers: number;
}): Promise<ScannedDocument> {
  const db = await initDb();
  const doc = buildScannedDocument({ ...input, id: newId() });
  await db.runAsync(
    `INSERT INTO scanned_document (${DOC_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      doc.id,
      doc.createdAt,
      doc.updatedAt,
      doc.consultId,
      doc.title,
      doc.docType,
      doc.pages,
      JSON.stringify(doc.imageUris),
      doc.rawText,
      doc.redactedText,
      doc.identifiers,
      doc.summary,
      doc.status,
    ],
  );
  return doc;
}

/** Read one scanned document, or null. */
export async function getScannedDocument(id: string): Promise<ScannedDocument | null> {
  const db = await initDb();
  const row = await db.getFirstAsync<DocRow>(
    `SELECT ${DOC_COLS} FROM scanned_document WHERE id = ? LIMIT 1;`,
    [id],
  );
  return row ? docFromRow(row) : null;
}

/** All scanned documents, newest first — powers the Smart Scan tab list. */
/** A scanned document for the list screen, with its consult's display label when attached. */
export interface ScannedDocumentListItem extends ScannedDocument {
  /** Patient name (preferred) or consult title of the attached consult, or null. */
  attachedTo: string | null;
}

export async function listScannedDocuments(): Promise<ScannedDocumentListItem[]> {
  const db = await initDb();
  const cols = DOC_COLS.split(", ").map((c) => `d.${c}`).join(", ");
  const rows = await db.getAllAsync<DocRow & { attachedTo: string | null }>(
    `SELECT ${cols}, COALESCE(c.patientName, c.title) AS attachedTo
     FROM scanned_document d LEFT JOIN consult c ON c.id = d.consultId
     ORDER BY d.createdAt DESC;`,
  );
  return rows.map((r) => ({ ...docFromRow(r), attachedTo: r.attachedTo }));
}

/** Documents attached to a consult — powers the note screen's document context. */
export async function getConsultDocuments(consultId: string): Promise<ScannedDocument[]> {
  const db = await initDb();
  const rows = await db.getAllAsync<DocRow>(
    `SELECT ${DOC_COLS} FROM scanned_document WHERE consultId = ? ORDER BY createdAt ASC;`,
    [consultId],
  );
  return rows.map(docFromRow);
}

/** Persist the clinician's text corrections (review screen edit). Re-redacted by the caller. */
export async function updateScannedDocumentText(
  id: string,
  rawText: string,
  redactedText: string,
  identifiers: number,
): Promise<void> {
  const db = await initDb();
  await db.runAsync(
    `UPDATE scanned_document SET rawText = ?, redactedText = ?, identifiers = ?, updatedAt = ? WHERE id = ?;`,
    [rawText, redactedText, identifiers, Date.now(), id],
  );
}

/** Store the on-device AI summary and mark the doc saved (standalone document note). */
export async function setScannedDocumentSummary(
  id: string,
  summary: string | null,
  status: ScannedDocStatus = "saved",
): Promise<void> {
  const db = await initDb();
  await db.runAsync(
    `UPDATE scanned_document SET summary = ?, status = ?, updatedAt = ? WHERE id = ?;`,
    [summary, status, Date.now(), id],
  );
}

/** Link a document to a consult (status "attached"). The caller audits + guards signed consults. */
export async function attachScannedDocument(id: string, consultId: string): Promise<void> {
  const db = await initDb();
  await db.runAsync(
    `UPDATE scanned_document SET consultId = ?, status = 'attached', updatedAt = ? WHERE id = ?;`,
    [consultId, Date.now(), id],
  );
}

/** Clear a document's page-image URIs after the files are deleted (sign / note save). */
/** Rename a scanned document (list label — keep it PII-free). */
export async function renameScannedDocument(id: string, title: string): Promise<void> {
  const db = await initDb();
  await db.runAsync(`UPDATE scanned_document SET title = ?, updatedAt = ? WHERE id = ?;`, [
    title,
    Date.now(),
    id,
  ]);
}

export async function clearScannedDocumentImages(id: string): Promise<void> {
  const db = await initDb();
  await db.runAsync(`UPDATE scanned_document SET imageUris = '[]', updatedAt = ? WHERE id = ?;`, [
    Date.now(),
    id,
  ]);
}

/** Permanently delete a scanned document row. Image files are the caller's to delete. */
export async function deleteScannedDocument(id: string): Promise<void> {
  const db = await initDb();
  await db.runAsync(`DELETE FROM scanned_document WHERE id = ?;`, [id]);
}

// --- Doctor voiceprint (diarization enrollment) ------------------------------
// BIOMETRIC PHI — device-only. Singleton row id='self'. Never logged/exported.

/** Store (upsert) the enrolled clinician voiceprint. `model` = embedder id (cache key). */
export async function saveDoctorVoiceprint(model: string, vec: number[]): Promise<void> {
  const db = await initDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO doctor_voiceprint (id, vec, model, updatedAt) VALUES ('self', ?, ?, ?);`,
    [JSON.stringify(vec), model, Date.now()],
  );
}

/** The enrolled clinician voiceprint, or null if the doctor hasn't enrolled. */
export async function getDoctorVoiceprint(): Promise<{ vec: number[]; model: string } | null> {
  const db = await initDb();
  const row = await db.getFirstAsync<{ vec: string; model: string }>(
    `SELECT vec, model FROM doctor_voiceprint WHERE id = 'self';`,
  );
  return row ? { vec: JSON.parse(row.vec) as number[], model: row.model } : null;
}

/** Delete the enrolled voiceprint (e.g. re-enroll, or clinician revokes). */
export async function clearDoctorVoiceprint(): Promise<void> {
  const db = await initDb();
  await db.runAsync(`DELETE FROM doctor_voiceprint WHERE id = 'self';`);
}

export * from "./types";
