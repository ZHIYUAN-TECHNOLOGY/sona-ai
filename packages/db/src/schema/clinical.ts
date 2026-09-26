import { sql } from "drizzle-orm";
import { boolean, customType, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, vector } from "drizzle-orm/pg-core";

/**
 * Clinical tables behind the built UI (see docs/delivery-plan.md). Every table that holds hospital
 * data carries hospital_id so row-level security can scope it; the shared public library leaves
 * hospital_id empty. Clinical values keep a source_id so answers can cite them.
 */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const created = () => timestamp("created_at").defaultNow().notNull();

export const hospitals = pgTable("hospitals", { id: text("id").primaryKey(), name: text("name").notNull() });

/** Which hospital a signed-in user works for; every clinical read and write is scoped by it. */
export const hospitalMembers = pgTable("hospital_members", {
  userId: text("user_id").primaryKey(), hospitalId: text("hospital_id").notNull().references(() => hospitals.id), createdAt: created(),
});

export const patients = pgTable("patients", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id").notNull().references(() => hospitals.id),
  name: text("name").notNull(), initials: text("initials").notNull(), age: integer("age").notNull(), sex: text("sex").notNull(),
  complaint: text("complaint").notNull(), allergies: text("allergies"), incomplete: boolean("incomplete").default(false).notNull(),
  record: jsonb("record").notNull().default({}),
});

/** One row per visit; the Durable Object owns the live state and snapshots it here with its revision. */
export const encounters = pgTable("encounters", {
  id: text("id").primaryKey(), patientId: text("patient_id").notNull().references(() => patients.id), hospitalId: text("hospital_id").notNull(),
  revision: integer("revision").default(1).notNull(), state: jsonb("state").notNull().default({}), updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** A note is a list of sentences with stable IDs, so a code or claim can point at the sentence that justifies it. */
export const notes = pgTable("notes", {
  id: text("id").primaryKey(), encounterId: text("encounter_id").notNull().references(() => encounters.id), revision: integer("revision").notNull(),
  sentences: jsonb("sentences").$type<{ id: string; text: string }[]>().notNull(), createdAt: created(),
}, t => [uniqueIndex("notes_encounter_revision").on(t.encounterId, t.revision)]);

/** Follow-ups, blocker owners and coding queries are all tasks; idempotency_key makes creation replay-safe. */
export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id").notNull(), encounterId: text("encounter_id"),
  kind: text("kind", { enum: ["followup", "blocker-owner", "coding-query", "discharge", "finding", "check-in"] }).notNull(),
  title: text("title").notNull(), owner: text("owner").notNull(), due: text("due"), completed: boolean("completed").default(false).notNull(),
  sourceId: text("source_id"), idempotencyKey: text("idempotency_key").unique(), createdAt: created(),
});

export const admissions = pgTable("admissions", {
  id: text("id").primaryKey(), patientId: text("patient_id").notNull().references(() => patients.id), hospitalId: text("hospital_id").notNull(),
  bed: text("bed").notNull(), fitAt: timestamp("fit_at"), dischargedAt: timestamp("discharged_at"),
});

export const guaranteeLetters = pgTable("guarantee_letters", {
  id: text("id").primaryKey(), admissionId: text("admission_id").notNull().references(() => admissions.id), insurer: text("insurer").notNull(),
  status: text("status", { enum: ["requested", "received"] }).notNull(), requestedAt: timestamp("requested_at").notNull(), receivedAt: timestamp("received_at"),
});

/** Immutable receipts for consequential actions; request_id is unique so a replay returns the same receipt. */
export const receipts = pgTable("receipts", {
  id: text("id").primaryKey(), kind: text("kind", { enum: ["prescription", "discharge", "claim"] }).notNull(),
  encounterId: text("encounter_id").notNull(), requestId: text("request_id").notNull().unique(), revision: integer("revision").notNull(),
  approvedBy: text("approved_by").notNull(), payload: jsonb("payload").notNull(), createdAt: created(),
});

export const claims = pgTable("claims", {
  id: text("id").primaryKey(), encounterId: text("encounter_id").notNull(), insurer: text("insurer").notNull(),
  status: text("status", { enum: ["draft", "sent", "approved"] }).notNull(), estimateCents: integer("estimate_cents").notNull(),
  codes: jsonb("codes").$type<{ code: string; evidence: string }[]>().notNull(), sentAt: timestamp("sent_at"), approvedAt: timestamp("approved_at"),
});

/** Insurer rules as rows so the check is deterministic; the policy text lives in the retrieval library. */
export const insurerCriteria = pgTable("insurer_criteria", {
  id: text("id").primaryKey(), insurer: text("insurer").notNull(), code: text("code"), label: text("label").notNull(), rule: jsonb("rule").notNull(),
});

export const observations = pgTable("observations", {
  id: text("id").primaryKey(), patientId: text("patient_id").notNull(), kind: text("kind").notNull(), value: real("value").notNull(),
  unit: text("unit").notNull(), sourceId: text("source_id").notNull(), observedAt: timestamp("observed_at").defaultNow().notNull(),
});

export const labResults = pgTable("lab_results", {
  id: text("id").primaryKey(), patientId: text("patient_id").notNull(), test: text("test").notNull(), value: text("value").notNull(),
  unit: text("unit"), flag: text("flag"), sourceId: text("source_id").notNull(), receivedAt: timestamp("received_at").defaultNow().notNull(),
  /** Who first acknowledged the result, and when; empty while it still needs a doctor to see it. */
  acknowledgedBy: text("acknowledged_by"), acknowledgedAt: timestamp("acknowledged_at"),
});

export const appointments = pgTable("appointments", {
  id: text("id").primaryKey(), patientId: text("patient_id").notNull(), hospitalId: text("hospital_id").notNull(),
  startsAt: timestamp("starts_at").notNull(), kind: text("kind").notNull(),
});

export const handoverAcceptances = pgTable("handover_acceptances", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id").notNull(), fromUser: text("from_user").notNull(), toUser: text("to_user").notNull(),
  cardIds: jsonb("card_ids").$type<string[]>().notNull(), acceptedAt: timestamp("accepted_at").defaultNow().notNull(),
  /** The app's request ID, so a replayed "hold to accept" returns the one acceptance. */
  requestId: text("request_id").unique(),
});

export const auditItems = pgTable("audit_items", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id").notNull(), encounterId: text("encounter_id"), patientId: text("patient_id").notNull(),
  doctor: text("doctor").notNull(), gap: text("gap").notNull(), fromCode: text("from_code"), toCode: text("to_code").notNull(),
  riskCents: integer("risk_cents").notNull(), query: text("query").notNull(),
  status: text("status", { enum: ["open", "queried", "resolved"] }).default("open").notNull(), createdAt: created(),
});

export const icd10Codes = pgTable("icd10_codes", { code: text("code").primaryKey(), label: text("label").notNull(), chapter: text("chapter") },
  t => [index("icd10_label_trgm").using("gin", sql`${t.label} gin_trgm_ops`)]);

export const casemixWeights = pgTable("casemix_weights", { code: text("code").primaryKey(), weight: real("weight").notNull(), baseRateCents: integer("base_rate_cents").notNull() });

export const drugs = pgTable("drugs", {
  id: text("id").primaryKey(), name: text("name").notNull(), ingredient: text("ingredient").notNull(), formulation: text("formulation"),
  dose: text("dose").notNull(), sourceId: text("source_id").notNull(), formulary: boolean("formulary").default(false).notNull(),
});

/** Retrieval library. hospital_id empty = the shared public library; set = one hospital's own documents. */
export const documents = pgTable("documents", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id"), title: text("title").notNull(), source: text("source").notNull(),
  year: integer("year").notNull(), license: text("license"), uploadedBy: text("uploaded_by"), createdAt: created(),
});

export const chunks = pgTable("chunks", {
  id: text("id").primaryKey(), documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  hospitalId: text("hospital_id"), sourceId: text("source_id").notNull(), section: text("section").notNull(), text: text("text").notNull(),
  embedding: vector("embedding", { dimensions: 768 }), search: tsvector("search"),
}, t => [
  index("chunks_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
  index("chunks_search_gin").using("gin", t.search),
]);

/** Every AI output with the sources it used, the model that wrote it and who approved it. */
export const provenance = pgTable("provenance", {
  id: text("id").primaryKey(), encounterId: text("encounter_id"), kind: text("kind").notNull(), output: jsonb("output").notNull(),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull(), model: text("model").notNull(), approvedBy: text("approved_by"), createdAt: created(),
});

/**
 * Demo flow 6: follow-up rules as data (Fleischner-style intervals for nodules, local rules for
 * the rest), so the interval a finding gets is looked up, never generated.
 */
export const followUpRules = pgTable("follow_up_rules", {
  id: text("id").primaryKey(), kind: text("kind", { enum: ["nodule", "cardiomegaly", "effusion"] }).notNull(),
  riskBand: text("risk_band", { enum: ["low", "intermediate", "high"] }).notNull(),
  /** Size range in millimetres the rule covers (nodules only; empty for the rest). */
  minMm: real("min_mm"), maxMm: real("max_mm"),
  /** Days until the follow-up is due; empty when no routine follow-up is needed. */
  intervalDays: integer("interval_days"), action: text("action").notNull(), source: text("source").notNull(),
});

/**
 * Demo flow 6: something on an image beyond the question asked. Never validated in this demo; the
 * location is normalised (0 to 1) on the image. Accepting it creates a task and a recall.
 */
export const findings = pgTable("findings", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id").notNull(), patientId: text("patient_id").notNull(), encounterId: text("encounter_id").notNull(),
  imageKey: text("image_key"), kind: text("kind", { enum: ["nodule", "cardiomegaly", "effusion"] }).notNull(), label: text("label").notNull(),
  sizeMm: real("size_mm"), location: jsonb("location").$type<{ x: number; y: number; zone: string }>().notNull(),
  riskBand: text("risk_band", { enum: ["low", "intermediate", "high"] }).notNull(), ruleId: text("rule_id").references(() => followUpRules.id),
  status: text("status", { enum: ["open", "tracked", "dismissed"] }).default("open").notNull(),
  /** "fixture" or the model version that read the image, so a fixture is never shown as a reading. */
  source: text("source").notNull(), taskId: text("task_id"), dueAt: timestamp("due_at"), createdAt: created(),
}, t => [uniqueIndex("findings_encounter_kind").on(t.encounterId, t.kind)]);

/** Demo flow 7: messages after discharge on day 2 and day 7, in the leaflet's language, through a simulated inbox. */
export const checkIns = pgTable("check_ins", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id").notNull(), patientId: text("patient_id").notNull(), encounterId: text("encounter_id").notNull(),
  day: integer("day").notNull(), language: text("language", { enum: ["ms", "en", "zh"] }).notNull(), message: text("message").notNull(),
  dueAt: timestamp("due_at").notNull(), sentAt: timestamp("sent_at"), createdAt: created(),
}, t => [uniqueIndex("check_ins_encounter_day").on(t.encounterId, t.day)]);

/** A patient's reply to a check-in, with how it was read; worse or urgent replies carry the flagged task. */
export const checkInReplies = pgTable("check_in_replies", {
  id: text("id").primaryKey(), checkInId: text("check_in_id").notNull().references(() => checkIns.id), text: text("text").notNull(),
  label: text("label", { enum: ["fine", "worse", "urgent"] }).notNull(), source: text("source").notNull(), taskId: text("task_id"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
});
