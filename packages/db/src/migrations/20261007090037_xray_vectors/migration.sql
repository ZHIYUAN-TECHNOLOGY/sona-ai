CREATE TABLE "image_vectors" (
	"key" text PRIMARY KEY,
	"hospital_id" text NOT NULL,
	"encounter_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"embedding" vector(512) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "image_vectors_embedding_hnsw" ON "image_vectors" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "image_vectors_hospital" ON "image_vectors" ("hospital_id");