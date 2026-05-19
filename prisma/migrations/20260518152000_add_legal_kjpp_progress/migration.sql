CREATE TABLE IF NOT EXISTS "legal_kjpp_progress" (
  "id" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "third_party_id" TEXT NOT NULL,
  "appraisal_type" TEXT NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL,
  "estimated_completed_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PROSES',
  "report_number" TEXT,
  "collateral_object" TEXT,
  "appraisal_value" DECIMAL(18,2),
  "notes" TEXT,
  "file_path" TEXT,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "legal_kjpp_progress_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "legal_kjpp_progress_contract_id_idx" ON "legal_kjpp_progress"("contract_id");
CREATE INDEX IF NOT EXISTS "legal_kjpp_progress_third_party_id_idx" ON "legal_kjpp_progress"("third_party_id");
CREATE INDEX IF NOT EXISTS "legal_kjpp_progress_status_idx" ON "legal_kjpp_progress"("status");
CREATE INDEX IF NOT EXISTS "legal_kjpp_progress_deleted_at_idx" ON "legal_kjpp_progress"("deleted_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'legal_kjpp_progress_contract_id_fkey'
  ) THEN
    ALTER TABLE "legal_kjpp_progress"
      ADD CONSTRAINT "legal_kjpp_progress_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'legal_kjpp_progress_third_party_id_fkey'
  ) THEN
    ALTER TABLE "legal_kjpp_progress"
      ADD CONSTRAINT "legal_kjpp_progress_third_party_id_fkey"
      FOREIGN KEY ("third_party_id") REFERENCES "third_parties"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
