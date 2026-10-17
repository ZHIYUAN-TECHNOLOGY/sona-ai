CREATE TABLE "pubmed_searches" (
	"terms" text PRIMARY KEY,
	"pmids" jsonb NOT NULL,
	"searched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provenance" ADD COLUMN "input_key" text;--> statement-breakpoint
CREATE INDEX "appointments_hospital" ON "appointments" ("hospital_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_patient" ON "appointments" ("patient_id");--> statement-breakpoint
CREATE INDEX "claims_encounter" ON "claims" ("encounter_id");--> statement-breakpoint
CREATE INDEX "encounters_patient" ON "encounters" ("patient_id","updated_at");--> statement-breakpoint
CREATE INDEX "encounters_hospital" ON "encounters" ("hospital_id");--> statement-breakpoint
CREATE INDEX "findings_hospital" ON "findings" ("hospital_id","patient_id");--> statement-breakpoint
CREATE INDEX "lab_results_patient" ON "lab_results" ("patient_id","flag");--> statement-breakpoint
CREATE INDEX "provenance_answer" ON "provenance" ("encounter_id","kind","input_key");--> statement-breakpoint
CREATE INDEX "tasks_hospital" ON "tasks" ("hospital_id","kind");