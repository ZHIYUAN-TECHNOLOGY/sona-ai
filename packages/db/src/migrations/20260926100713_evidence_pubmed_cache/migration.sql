CREATE TABLE "pubmed_articles" (
	"pmid" text PRIMARY KEY,
	"title" text NOT NULL,
	"journal" text NOT NULL,
	"year" integer NOT NULL,
	"publication_types" jsonb NOT NULL,
	"conclusion" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
