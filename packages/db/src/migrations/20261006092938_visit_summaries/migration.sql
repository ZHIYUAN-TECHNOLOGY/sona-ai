CREATE TABLE "visit_summaries" (
	"id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"encounter_id" text NOT NULL,
	"text" text NOT NULL,
	"what_changed" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"checks" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"origin" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"approved_text" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "visit_summaries_hospital" ON "visit_summaries" ("hospital_id","status","created_at");--> statement-breakpoint
CREATE INDEX "visit_summaries_patient" ON "visit_summaries" ("patient_id","status");--> statement-breakpoint
ALTER TABLE "visit_summaries" ADD CONSTRAINT "visit_summaries_encounter_id_encounters_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id");