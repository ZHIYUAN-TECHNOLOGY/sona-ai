CREATE TABLE "hospital_members" (
	"user_id" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hospital_members" ADD CONSTRAINT "hospital_members_hospital_id_hospitals_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id");