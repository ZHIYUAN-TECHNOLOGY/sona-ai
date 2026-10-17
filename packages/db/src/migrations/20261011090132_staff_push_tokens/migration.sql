CREATE TABLE "staff_push_tokens" (
	"token" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"hospital_id" text NOT NULL,
	"platform" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "staff_push_tokens_hospital" ON "staff_push_tokens" ("hospital_id");