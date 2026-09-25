CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admissions" (
	"id" text PRIMARY KEY,
	"patient_id" text NOT NULL,
	"hospital_id" text NOT NULL,
	"bed" text NOT NULL,
	"fit_at" timestamp,
	"discharged_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" text PRIMARY KEY,
	"patient_id" text NOT NULL,
	"hospital_id" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_items" (
	"id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"encounter_id" text,
	"patient_id" text NOT NULL,
	"doctor" text NOT NULL,
	"gap" text NOT NULL,
	"from_code" text,
	"to_code" text NOT NULL,
	"risk_cents" integer NOT NULL,
	"query" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casemix_weights" (
	"code" text PRIMARY KEY,
	"weight" real NOT NULL,
	"base_rate_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" text PRIMARY KEY,
	"document_id" text NOT NULL,
	"hospital_id" text,
	"source_id" text NOT NULL,
	"section" text NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(768),
	"search" tsvector
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY,
	"encounter_id" text NOT NULL,
	"insurer" text NOT NULL,
	"status" text NOT NULL,
	"estimate_cents" integer NOT NULL,
	"codes" jsonb NOT NULL,
	"sent_at" timestamp,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY,
	"hospital_id" text,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"year" integer NOT NULL,
	"license" text,
	"uploaded_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drugs" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"ingredient" text NOT NULL,
	"formulation" text,
	"dose" text NOT NULL,
	"source_id" text NOT NULL,
	"formulary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" text PRIMARY KEY,
	"patient_id" text NOT NULL,
	"hospital_id" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"state" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guarantee_letters" (
	"id" text PRIMARY KEY,
	"admission_id" text NOT NULL,
	"insurer" text NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp NOT NULL,
	"received_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "handover_acceptances" (
	"id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"from_user" text NOT NULL,
	"to_user" text NOT NULL,
	"card_ids" jsonb NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hospitals" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icd10_codes" (
	"code" text PRIMARY KEY,
	"label" text NOT NULL,
	"chapter" text
);
--> statement-breakpoint
CREATE TABLE "insurer_criteria" (
	"id" text PRIMARY KEY,
	"insurer" text NOT NULL,
	"code" text,
	"label" text NOT NULL,
	"rule" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_results" (
	"id" text PRIMARY KEY,
	"patient_id" text NOT NULL,
	"test" text NOT NULL,
	"value" text NOT NULL,
	"unit" text,
	"flag" text,
	"source_id" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY,
	"encounter_id" text NOT NULL,
	"revision" integer NOT NULL,
	"sentences" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" text PRIMARY KEY,
	"patient_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" real NOT NULL,
	"unit" text NOT NULL,
	"source_id" text NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"name" text NOT NULL,
	"initials" text NOT NULL,
	"age" integer NOT NULL,
	"sex" text NOT NULL,
	"complaint" text NOT NULL,
	"allergies" text,
	"incomplete" boolean DEFAULT false NOT NULL,
	"record" jsonb DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provenance" (
	"id" text PRIMARY KEY,
	"encounter_id" text,
	"kind" text NOT NULL,
	"output" jsonb NOT NULL,
	"source_ids" jsonb NOT NULL,
	"model" text NOT NULL,
	"approved_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"encounter_id" text NOT NULL,
	"request_id" text NOT NULL UNIQUE,
	"revision" integer NOT NULL,
	"approved_by" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"encounter_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"owner" text NOT NULL,
	"due" text,
	"completed" boolean DEFAULT false NOT NULL,
	"source_id" text,
	"idempotency_key" text UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_search_gin" ON "chunks" USING gin ("search");--> statement-breakpoint
CREATE INDEX "icd10_label_trgm" ON "icd10_codes" USING gin ("label" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "notes_encounter_revision" ON "notes" ("encounter_id","revision");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_patient_id_patients_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id");--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_patients_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id");--> statement-breakpoint
ALTER TABLE "guarantee_letters" ADD CONSTRAINT "guarantee_letters_admission_id_admissions_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id");--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_encounter_id_encounters_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id");--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_hospital_id_hospitals_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id");