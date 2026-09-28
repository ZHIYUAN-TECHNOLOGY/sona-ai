CREATE TABLE "training_consents" (
	"patient_id" text,
	"hospital_id" text,
	"consented_at" timestamp,
	"withdrawn_at" timestamp,
	CONSTRAINT "training_consents_pkey" PRIMARY KEY("patient_id","hospital_id")
);
--> statement-breakpoint
CREATE TABLE "training_datasets" (
	"hospital_id" text,
	"version" integer,
	"rows" integer NOT NULL,
	"r2_key" text NOT NULL,
	"exported_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "training_datasets_pkey" PRIMARY KEY("hospital_id","version")
);
--> statement-breakpoint
CREATE TABLE "training_samples" (
	"id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"input" text NOT NULL,
	"output" text NOT NULL,
	"replacements" jsonb NOT NULL,
	"deidentifier" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"leak" jsonb,
	"dataset_version" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hospitals" ADD COLUMN "contributes_training" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "training_samples_hospital" ON "training_samples" ("hospital_id","status");