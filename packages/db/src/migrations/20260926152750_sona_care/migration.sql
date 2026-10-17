CREATE TABLE "care_codes" (
	"code" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"encounter_id" text NOT NULL UNIQUE,
	"expires_at" timestamp NOT NULL,
	"redeemed_by" text,
	"redeemed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_links" (
	"user_id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_messages" (
	"id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"from" text NOT NULL,
	"author_id" text NOT NULL,
	"text" text NOT NULL,
	"task_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "care_messages_patient" ON "care_messages" ("patient_id","created_at");