ALTER TABLE "documents" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "kind" text DEFAULT 'text' NOT NULL;