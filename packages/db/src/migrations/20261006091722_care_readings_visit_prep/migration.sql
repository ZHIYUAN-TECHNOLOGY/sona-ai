ALTER TABLE "appointments" ADD COLUMN "prep" jsonb;--> statement-breakpoint
ALTER TABLE "observations" ADD COLUMN "source" text DEFAULT 'clinical' NOT NULL;