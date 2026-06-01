ALTER TABLE "debtor_import_jobs"
  ADD COLUMN IF NOT EXISTS "period_month" TEXT,
  ADD COLUMN IF NOT EXISTS "files" JSONB,
  ADD COLUMN IF NOT EXISTS "processing_summary" JSONB;

CREATE INDEX IF NOT EXISTS "debtor_import_jobs_period_month_idx"
  ON "debtor_import_jobs"("period_month");

CREATE TABLE IF NOT EXISTS "debtor_import_segments" (
  "id" TEXT NOT NULL,
  "import_job_id" TEXT NOT NULL,
  "segment" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "sequence" INTEGER,
  "declared_rows" INTEGER NOT NULL DEFAULT 0,
  "actual_rows" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "error_summary" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "debtor_import_segments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "debtor_import_segments_import_job_id_segment_file_name_key"
  ON "debtor_import_segments"("import_job_id", "segment", "file_name");

CREATE INDEX IF NOT EXISTS "debtor_import_segments_import_job_id_idx"
  ON "debtor_import_segments"("import_job_id");

CREATE INDEX IF NOT EXISTS "debtor_import_segments_segment_idx"
  ON "debtor_import_segments"("segment");

CREATE INDEX IF NOT EXISTS "debtor_import_segments_status_idx"
  ON "debtor_import_segments"("status");

CREATE TABLE IF NOT EXISTS "debtor_slik_records" (
  "id" TEXT NOT NULL,
  "import_job_id" TEXT NOT NULL,
  "segment" TEXT NOT NULL,
  "period_month" TEXT NOT NULL,
  "row_number" INTEGER NOT NULL,
  "raw_key" TEXT,
  "raw_data" JSONB NOT NULL,
  "debtor_id" TEXT,
  "contract_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'IMPORTED',
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "debtor_slik_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "debtor_slik_records_import_job_id_idx"
  ON "debtor_slik_records"("import_job_id");

CREATE INDEX IF NOT EXISTS "debtor_slik_records_segment_idx"
  ON "debtor_slik_records"("segment");

CREATE INDEX IF NOT EXISTS "debtor_slik_records_period_month_idx"
  ON "debtor_slik_records"("period_month");

CREATE INDEX IF NOT EXISTS "debtor_slik_records_raw_key_idx"
  ON "debtor_slik_records"("raw_key");

CREATE INDEX IF NOT EXISTS "debtor_slik_records_debtor_id_idx"
  ON "debtor_slik_records"("debtor_id");

CREATE INDEX IF NOT EXISTS "debtor_slik_records_contract_id_idx"
  ON "debtor_slik_records"("contract_id");

CREATE INDEX IF NOT EXISTS "debtor_slik_records_status_idx"
  ON "debtor_slik_records"("status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debtor_import_segments_import_job_id_fkey'
  ) THEN
    ALTER TABLE "debtor_import_segments"
      ADD CONSTRAINT "debtor_import_segments_import_job_id_fkey"
      FOREIGN KEY ("import_job_id") REFERENCES "debtor_import_jobs"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debtor_slik_records_import_job_id_fkey'
  ) THEN
    ALTER TABLE "debtor_slik_records"
      ADD CONSTRAINT "debtor_slik_records_import_job_id_fkey"
      FOREIGN KEY ("import_job_id") REFERENCES "debtor_import_jobs"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debtor_slik_records_debtor_id_fkey'
  ) THEN
    ALTER TABLE "debtor_slik_records"
      ADD CONSTRAINT "debtor_slik_records_debtor_id_fkey"
      FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debtor_slik_records_contract_id_fkey'
  ) THEN
    ALTER TABLE "debtor_slik_records"
      ADD CONSTRAINT "debtor_slik_records_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
