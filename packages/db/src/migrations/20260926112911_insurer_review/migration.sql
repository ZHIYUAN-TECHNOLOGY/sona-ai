ALTER TABLE "claims" ADD COLUMN "review_token" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "decided_at" timestamp;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "insurer_note" text;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_review_token_key" UNIQUE("review_token");