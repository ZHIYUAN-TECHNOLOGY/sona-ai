-- One discharge and one claim receipt per encounter, so two approvals racing with different requestIds cannot both land.
CREATE UNIQUE INDEX IF NOT EXISTS receipts_one_per_encounter ON receipts (kind, encounter_id) WHERE kind IN ('discharge', 'claim');
