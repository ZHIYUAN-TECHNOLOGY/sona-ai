ALTER TABLE "handover_acceptances" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "handover_acceptances" ADD CONSTRAINT "handover_acceptances_request_id_key" UNIQUE("request_id");