ALTER TABLE "claims" ADD COLUMN "denial_code" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "denial_reason" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "appeal" jsonb;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "appealed_at" timestamp;