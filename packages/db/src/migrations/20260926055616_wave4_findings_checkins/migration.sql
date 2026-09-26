CREATE TABLE "check_in_replies" (
	"id" text PRIMARY KEY,
	"check_in_id" text NOT NULL,
	"text" text NOT NULL,
	"label" text NOT NULL,
	"source" text NOT NULL,
	"task_id" text,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_ins" (
	"id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"encounter_id" text NOT NULL,
	"day" integer NOT NULL,
	"language" text NOT NULL,
	"message" text NOT NULL,
	"due_at" timestamp NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"encounter_id" text NOT NULL,
	"image_key" text,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"size_mm" real,
	"location" jsonb NOT NULL,
	"risk_band" text NOT NULL,
	"rule_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"source" text NOT NULL,
	"task_id" text,
	"due_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_up_rules" (
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"risk_band" text NOT NULL,
	"min_mm" real,
	"max_mm" real,
	"interval_days" integer,
	"action" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_encounter_day" ON "check_ins" ("encounter_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_encounter_kind" ON "findings" ("encounter_id","kind");--> statement-breakpoint
ALTER TABLE "check_in_replies" ADD CONSTRAINT "check_in_replies_check_in_id_check_ins_id_fkey" FOREIGN KEY ("check_in_id") REFERENCES "check_ins"("id");--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_rule_id_follow_up_rules_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "follow_up_rules"("id");