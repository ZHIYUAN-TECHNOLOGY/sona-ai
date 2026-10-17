-- Retrieval library row-level security: a role that is subject to it sees the shared library
-- (hospital_id null) and its own hospital's documents, chosen by the per-transaction setting
-- app.hospital_id. The table owner (the app's current Neon role) still bypasses it until the app
-- connects as a restricted role with transactions; the search query also filters by hospital.
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY library_or_own_hospital ON documents
  USING (hospital_id IS NULL OR hospital_id = current_setting('app.hospital_id', true))
  WITH CHECK (hospital_id IS NULL OR hospital_id = current_setting('app.hospital_id', true));
--> statement-breakpoint
CREATE POLICY library_or_own_hospital ON chunks
  USING (hospital_id IS NULL OR hospital_id = current_setting('app.hospital_id', true))
  WITH CHECK (hospital_id IS NULL OR hospital_id = current_setting('app.hospital_id', true));
