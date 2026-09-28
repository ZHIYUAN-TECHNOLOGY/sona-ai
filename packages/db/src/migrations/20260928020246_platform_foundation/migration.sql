CREATE TABLE "access_logs" (
	"id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"user_id" text NOT NULL,
	"patient_id" text,
	"encounter_id" text,
	"route" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_requests" (
	"id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"doctor_id" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"reason" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"task_id" text,
	"appointment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "doctors" (
	"id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"name" text NOT NULL,
	"specialty" text NOT NULL,
	"years" integer NOT NULL,
	"rating" real NOT NULL,
	"reviews" integer NOT NULL,
	"room" text NOT NULL,
	"languages" jsonb NOT NULL,
	"about" text NOT NULL,
	"tags" jsonb NOT NULL,
	"days" jsonb NOT NULL,
	"times" jsonb NOT NULL,
	"care_team" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"token" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"platform" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hospital_members" ADD COLUMN "role" text DEFAULT 'doctor' NOT NULL;--> statement-breakpoint
CREATE INDEX "access_logs_patient" ON "access_logs" ("hospital_id","patient_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_requests_slot" ON "booking_requests" ("patient_id","doctor_id","starts_at");--> statement-breakpoint
CREATE INDEX "push_tokens_patient" ON "push_tokens" ("patient_id");--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_doctor_id_doctors_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id");--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_hospital_id_hospitals_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id");