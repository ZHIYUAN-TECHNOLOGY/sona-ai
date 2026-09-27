CREATE TABLE "dose_logs" (
	"id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"key" text NOT NULL,
	"taken_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dose_logs_patient" ON "dose_logs" ("hospital_id","patient_id");--> statement-breakpoint
ALTER TABLE "dose_logs" ADD CONSTRAINT "dose_logs_patient_id_patients_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id");