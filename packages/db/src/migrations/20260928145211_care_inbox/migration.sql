ALTER TABLE "care_messages" ADD COLUMN "seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "care_messages" ADD COLUMN "triage" text;--> statement-breakpoint
ALTER TABLE "care_messages" ADD COLUMN "triage_reason" text;