import { sql } from "drizzle-orm";
import { bigint, boolean, customType, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, vector } from "drizzle-orm/pg-core";

/**
 * Clinical tables behind the built UI (see docs/delivery-plan.md). Every table that holds hospital
 * data carries hospital_id so row-level security can scope it; the shared public library leaves
 * hospital_id empty. Clinical values keep a source_id so answers can cite them.
 */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const created = () => timestamp("created_at").defaultNow().notNull();

/**
 * `clockOffsetMs` is the demo clock: every route reads time as now + offset for this hospital (see
 * clockOf), so a demo can jump to day 2 after discharge without waiting. 0 is real time.
 * `contributesTraining`: management opted the hospital into de-identified training samples (off by default).
 */
export const hospitals = pgTable("hospitals", {
  id: text("id").primaryKey(), name: text("name").notNull(), clockOffsetMs: bigint("clock_offset_ms", { mode: "number" }).notNull().default(0),
  contributesTraining: boolean("contributes_training").default(false).notNull(),
});

/** Which hospital a signed-in user works for; every clinical read and write is scoped by it. */
export const hospitalMembers = pgTable("hospital_members", {
  userId: text("user_id").primaryKey(), hospitalId: text("hospital_id").notNull().references(() => hospitals.id), createdAt: created(),
  /** What this clinician may see and do (see packages/api roles): doctor (default), nurse, bed manager, management. */
  role: text("role", { enum: ["doctor", "nurse", "bed-manager", "management"] }).default("doctor").notNull(),
});

/**
 * Who opened which patient's record, when and through which route (PDPA access trail). Written by
 * the API for every clinician read or write that names a patient or visit; never for Sona Care's own.
 */
export const accessLogs = pgTable("access_logs", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id").notNull(), userId: text("user_id").notNull(),
  patientId: text("patient_id"), encounterId: text("encounter_id"), route: text("route").notNull(), at: timestamp("at").defaultNow().notNull(),
}, t => [index("access_logs_patient").on(t.hospitalId, t.patientId, t.at)]);

/** A phone that receives Sona Care push notifications (Expo push token), per signed-in patient account. */
export const pushTokens = pgTable("push_tokens", {
  token: text("token").primaryKey(), userId: text("user_id").notNull(), hospitalId: text("hospital_id").notNull(), patientId: text("patient_id").notNull(),
  platform: text("platform").notNull(), updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, t => [index("push_tokens_patient").on(t.patientId)]);

/**
 * The hospital's clinicians as patients see them in Find a doctor (SYNTHETIC in the demo): specialty,
 * room, languages, and weekly clinic sessions (weekday 0 Sun … 6 Sat, "HH:MM" Malaysia time).
 */
export const doctors = pgTable("doctors", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id").notNull().references(() => hospitals.id),
  name: text("name").notNull(), specialty: text("specialty").notNull(), years: integer("years").notNull(), rating: real("rating").notNull(), reviews: integer("reviews").notNull(),
  room: text("room").notNull(), languages: jsonb("languages").$type<string[]>().notNull(), about: text("about").notNull(), tags: jsonb("tags").$type<string[]>().notNull(),
  days: jsonb("days").$type<number[]>().notNull(), times: jsonb("times").$type<string[]>().notNull(),
  /** On the demo ward's care team (the doctors a discharged patient's plan names). */
  careTeam: boolean("care_team").default(false).notNull(),
});

/**
 * A patient's request for a clinic slot with a doctor: the care team confirms (it becomes an
 * appointment) or offers another time. One request per patient, doctor and slot.
 */
export const bookingRequests = pgTable("booking_requests", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id").notNull(), patientId: text("patient_id").notNull(), doctorId: text("doctor_id").notNull().references(() => doctors.id),
  startsAt: timestamp("starts_at").notNull(), reason: text("reason"), status: text("status", { enum: ["requested", "confirmed", "declined"] }).default("requested").notNull(),
  taskId: text("task_id"), appointmentId: text("appointment_id"), createdAt: created(), decidedAt: timestamp("decided_at"),
}, t => [uniqueIndex("booking_requests_slot").on(t.patientId, t.doctorId, t.startsAt)]);

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
}, t => [index("encounters_patient").on(t.patientId, t.updatedAt), index("encounters_hospital").on(t.hospitalId)]);

/** A note is a list of sentences with stable IDs, so a code or claim can point at the sentence that justifies it. */
export const notes = pgTable("notes", {
  id: text("id").primaryKey(), encounterId: text("encounter_id").notNull().references(() => encounters.id), revision: integer("revision").notNull(),
  sentences: jsonb("sentences").$type<{ id: string; text: string }[]>().notNull(), createdAt: created(),
}, t => [uniqueIndex("notes_encounter_revision").on(t.encounterId, t.revision)]);

/** Follow-ups, blocker owners and coding queries are all tasks; idempotency_key makes creation replay-safe. */
export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id").notNull(), encounterId: text("encounter_id"),
  kind: text("kind", { enum: ["followup", "blocker-owner", "coding-query", "discharge", "finding", "check-in", "message", "booking"] }).notNull(),
  title: text("title").notNull(), owner: text("owner").notNull(), due: text("due"), completed: boolean("completed").default(false).notNull(),
  sourceId: text("source_id"), idempotencyKey: text("idempotency_key").unique(), createdAt: created(),
}, t => [index("tasks_hospital").on(t.hospitalId, t.kind)]);

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
  id: text("id").primaryKey(), kind: text("kind", { enum: ["prescription", "discharge", "claim", "appeal"] }).notNull(),
  encounterId: text("encounter_id").notNull(), requestId: text("request_id").notNull().unique(), revision: integer("revision").notNull(),
  approvedBy: text("approved_by").notNull(), payload: jsonb("payload").notNull(), createdAt: created(),
});

export const claims = pgTable("claims", {
  id: text("id").primaryKey(), encounterId: text("encounter_id").notNull(), insurer: text("insurer").notNull(),
  status: text("status", { enum: ["draft", "sent", "approved", "queried", "denied", "appealed"] }).notNull(), estimateCents: integer("estimate_cents").notNull(),
  codes: jsonb("codes").$type<{ code: string; evidence: string; label?: string; kind?: string; text?: string }[]>().notNull(), sentAt: timestamp("sent_at"), approvedAt: timestamp("approved_at"),
  /** The insurer's review link: an unguessable token, so the page needs no login (it expires a week after sending). */
  reviewToken: text("review_token").unique(),
  /** When the insurer approved or queried, and the question they asked with a query. */
  decidedAt: timestamp("decided_at"), insurerNote: text("insurer_note"),
  /** A denial's code and reason (the insurer's free text, if any, is `insurerNote`); kept after an appeal so its history reads. */
  denialCode: text("denial_code"), denialReason: text("denial_reason"), deniedAt: timestamp("denied_at"),
  /** The appeal the doctor approved, each point frozen with the note sentence it cites, and when it went. */
  appeal: jsonb("appeal").$type<{ opening: string; points: { claim: string; evidenceSentenceId: string; text: string }[]; closing: string }>(), appealedAt: timestamp("appealed_at"),
}, t => [index("claims_encounter").on(t.encounterId)]);

/** Insurer rules as rows so the check is deterministic; the policy text lives in the retrieval library. */
export const insurerCriteria = pgTable("insurer_criteria", {
  id: text("id").primaryKey(), insurer: text("insurer").notNull(), code: text("code"), label: text("label").notNull(), rule: jsonb("rule").notNull(),
});

export const observations = pgTable("observations", {
  id: text("id").primaryKey(), patientId: text("patient_id").notNull(), kind: text("kind").notNull(), value: real("value").notNull(),
  unit: text("unit").notNull(), sourceId: text("source_id").notNull(), observedAt: timestamp("observed_at").defaultNow().notNull(),
  /** Who took it: "clinical" on the ward, "patient" for a home reading from Sona Care, so the two are never confused. */
  source: text("source").$type<"clinical" | "patient">().default("clinical").notNull(),
});

export const labResults = pgTable("lab_results", {
  id: text("id").primaryKey(), patientId: text("patient_id").notNull(), test: text("test").notNull(), value: text("value").notNull(),
  unit: text("unit"), flag: text("flag"), sourceId: text("source_id").notNull(), receivedAt: timestamp("received_at").defaultNow().notNull(),
  /** Who first acknowledged the result, and when; empty while it still needs a doctor to see it. */
  acknowledgedBy: text("acknowledged_by"), acknowledgedAt: timestamp("acknowledged_at"),
}, t => [index("lab_results_patient").on(t.patientId, t.flag)]);

/**
 * Doses a Sona Care patient marked taken (hold to take), so the care team sees adherence. One row per
 * dose: `key` is the medicine and due time (@sona-ai/domain/doses), so marking it twice changes nothing.
 */
export const doseLogs = pgTable("dose_logs", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id").notNull(), patientId: text("patient_id").notNull().references(() => patients.id),
  key: text("key").notNull(), takenAt: timestamp("taken_at").notNull(), createdAt: created(),
}, t => [index("dose_logs_patient").on(t.hospitalId, t.patientId)]);

export const appointments = pgTable("appointments", {
  id: text("id").primaryKey(), patientId: text("patient_id").notNull(), hospitalId: text("hospital_id").notNull(),
  startsAt: timestamp("starts_at").notNull(), kind: text("kind").notNull(),
  /** When a doctor booked it from a flagged check-in (Book in), for the ops counter's flag-to-booked time. */
  bookedAt: timestamp("booked_at"),
  /** The directory doctor it is with (Book in with a doctor, a confirmed booking), so it holds only that doctor's slot. */
  doctorId: text("doctor_id"),
  /** What the patient prepared for this visit in Sona Care: up to three questions, and whether their last 7 days of home readings are shared. */
  prep: jsonb("prep").$type<{ questions: string[]; shareReadings: boolean }>(),
}, t => [index("appointments_hospital").on(t.hospitalId, t.startsAt), index("appointments_patient").on(t.patientId)]);

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

/**
 * Retrieval library. hospital_id empty = the shared public library; set = one hospital's own documents.
 * owner_id set = one doctor's private source (only they see or cite it); empty = the whole hospital's.
 * kind "leaflet" = one of the hospital's patient leaflets, the only kind a Sona Care answer may read (packages/retrieval's
 * search). No upload can set it (routers/library.ts), so a guideline never becomes one. `kind` is a plain text column,
 * so the new value needed no migration.
 */
export const documents = pgTable("documents", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id"), title: text("title").notNull(), source: text("source").notNull(),
  year: integer("year").notNull(), license: text("license"), uploadedBy: text("uploaded_by"), createdAt: created(),
  ownerId: text("owner_id"), kind: text("kind", { enum: ["text", "pdf", "pubmed", "leaflet"] }).default("text").notNull(),
});

export const chunks = pgTable("chunks", {
  id: text("id").primaryKey(), documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  hospitalId: text("hospital_id"), sourceId: text("source_id").notNull(), section: text("section").notNull(), text: text("text").notNull(),
  embedding: vector("embedding", { dimensions: 768 }), search: tsvector("search"),
}, t => [
  index("chunks_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
  index("chunks_search_gin").using("gin", t.search),
]);

/**
 * Every AI output with the sources it used, the model that wrote it and who approved it. `input_key` (a hash of what
 * the model was asked) lets a route hand back a model's stored answer instead of paying for the same one again.
 */
export const provenance = pgTable("provenance", {
  id: text("id").primaryKey(), encounterId: text("encounter_id"), kind: text("kind").notNull(), output: jsonb("output").notNull(),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull(), model: text("model").notNull(), approvedBy: text("approved_by"), createdAt: created(),
  inputKey: text("input_key"),
}, t => [index("provenance_answer").on(t.encounterId, t.kind, t.inputKey)]);

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
 * location is normalised (0 to 1) on the image, with the model's box ([y0, x0, y1, x1]) when it gave one. Accepting it creates a task and a recall.
 */
export const findings = pgTable("findings", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id").notNull(), patientId: text("patient_id").notNull(), encounterId: text("encounter_id").notNull(),
  imageKey: text("image_key"), kind: text("kind", { enum: ["nodule", "cardiomegaly", "effusion"] }).notNull(), label: text("label").notNull(),
  sizeMm: real("size_mm"), location: jsonb("location").$type<{ x: number; y: number; zone: string; box?: [number, number, number, number] }>().notNull(),
  riskBand: text("risk_band", { enum: ["low", "intermediate", "high"] }).notNull(), ruleId: text("rule_id").references(() => followUpRules.id),
  status: text("status", { enum: ["open", "tracked", "dismissed"] }).default("open").notNull(),
  /** "fixture" or the model version that read the image, so a fixture is never shown as a reading. */
  source: text("source").notNull(), taskId: text("task_id"), dueAt: timestamp("due_at"), createdAt: created(),
}, t => [uniqueIndex("findings_encounter_kind").on(t.encounterId, t.kind), index("findings_hospital").on(t.hospitalId, t.patientId)]);

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

/**
 * Flow 4: PubMed articles as last fetched, so an evidence answer still has its sources when PubMed is
 * slow or the stage has no network. Public bibliographic data, not hospital data: no hospital_id.
 */
export const pubmedArticles = pgTable("pubmed_articles", {
  pmid: text("pmid").primaryKey(), title: text("title").notNull(), journal: text("journal").notNull(), year: integer("year").notNull(),
  publicationTypes: jsonb("publication_types").$type<string[]>().notNull(), conclusion: text("conclusion").notNull(), fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

/** Flow 4: the PubMed IDs a search found, by its key terms, so a question asked again skips PubMed's search. Public data, like the articles. */
export const pubmedSearches = pgTable("pubmed_searches", {
  terms: text("terms").primaryKey(), pmids: jsonb("pmids").$type<string[]>().notNull(), searchedAt: timestamp("searched_at").defaultNow().notNull(),
});

/**
 * Sona Care (the patient app): a one-time code printed as a QR on the discharge paper. Redeeming it
 * links the patient's account to their own record, and only that record.
 */
export const careCodes = pgTable("care_codes", {
  code: text("code").primaryKey(), hospitalId: text("hospital_id").notNull(), patientId: text("patient_id").notNull(),
  encounterId: text("encounter_id").notNull().unique(), expiresAt: timestamp("expires_at").notNull(),
  redeemedBy: text("redeemed_by"), redeemedAt: timestamp("redeemed_at"), createdAt: created(),
});

/** A Sona Care account and the one patient record it may see. A linked account never opens clinical routes. */
export const careLinks = pgTable("care_links", {
  userId: text("user_id").primaryKey(), hospitalId: text("hospital_id").notNull(), patientId: text("patient_id").notNull(), linkedAt: created(),
});

/** Messages between a patient (Sona Care) and their care team; a patient's message raises a task for the team. */
export const careMessages = pgTable("care_messages", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id").notNull(), patientId: text("patient_id").notNull(),
  from: text("from", { enum: ["patient", "care-team"] }).notNull(), authorId: text("author_id").notNull(), text: text("text").notNull(),
  taskId: text("task_id"), createdAt: created(),
  /** Patient messages only: when the care team first opened the thread after it arrived (Sona Care shows "Seen"). */
  seenAt: timestamp("seen_at"),
  /** Patient messages only: the inbox triage (urgent, clinical, admin) and the words that decided it; empty if triage failed. */
  triage: text("triage", { enum: ["urgent", "clinical", "admin"] }), triageReason: text("triage_reason"),
  /** Patient messages only: what came with it (a medicine photo and its reading), and the care team's decision once made. */
  attachment: jsonb("attachment").$type<MessageAttachment>(),
}, t => [index("care_messages_patient").on(t.patientId, t.createdAt)]);

export type MedicineReading = { name: string; dose?: string; frequency?: string };
/**
 * A medicine photo from Sona Care: where the photo is (`key`, the bundled sample, or none when it stayed
 * on the phone), what was read (as the patient checked it) and whether that was the sample reading. The
 * care team's decision is added once: added to reconciliation (unconfirmed) or declined with a reply.
 */
export type MessageAttachment = {
  kind: "medicine-photo"; key?: string; reading: MedicineReading; sampleReading?: boolean;
  decision?: { status: "added" | "declined"; reading: MedicineReading; by: string; at: string };
};

/**
 * Continuous training (packages/api training.ts): a patient's own opt-in from Sona Care. Consented while
 * consented_at is set and withdrawn_at is empty; withdrawing keeps the row so the choice is on record.
 */
export const trainingConsents = pgTable("training_consents", {
  patientId: text("patient_id").notNull(), hospitalId: text("hospital_id").notNull(),
  consentedAt: timestamp("consented_at"), withdrawnAt: timestamp("withdrawn_at"),
}, t => [primaryKey({ columns: [t.patientId, t.hospitalId] })]);

/**
 * One de-identified training example. Only de-identified text lives here: the raw note or reply stays in
 * its own table (source_ref points at it). `leak` is what the gate found, as kinds only, never the value.
 */
export const trainingSamples = pgTable("training_samples", {
  id: text("id").primaryKey(), hospitalId: text("hospital_id").notNull(), patientId: text("patient_id").notNull(),
  source: text("source", { enum: ["note-edit", "check-in-reply", "transcript", "handwritten-scan"] }).notNull(), sourceRef: text("source_ref").notNull(),
  input: text("input").notNull(), output: text("output").notNull(),
  replacements: jsonb("replacements").$type<{ kind: "name" | "ic" | "phone" | "email" | "mrn"; placeholder: string }[]>().notNull(),
  /** "rules" for the stub, or the model that de-identified it. */
  deidentifier: text("deidentifier").notNull(),
  status: text("status", { enum: ["pending", "approved", "blocked", "excluded", "withdrawn"] }).default("pending").notNull(),
  leak: jsonb("leak").$type<("name" | "ic" | "phone" | "email" | "mrn")[]>(),
  /** The export this sample went out in; empty until then. */
  datasetVersion: integer("dataset_version"), createdAt: created(),
}, t => [index("training_samples_hospital").on(t.hospitalId, t.status)]);

/** A versioned JSONL export of approved samples, written to R2 at r2_key. */
export const trainingDatasets = pgTable("training_datasets", {
  hospitalId: text("hospital_id").notNull(), version: integer("version").notNull(), rows: integer("rows").notNull(),
  r2Key: text("r2_key").notNull(), exportedAt: timestamp("exported_at").defaultNow().notNull(),
}, t => [primaryKey({ columns: [t.hospitalId, t.version] })]);
