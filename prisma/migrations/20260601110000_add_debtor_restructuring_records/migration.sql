CREATE TABLE "debtor_restructuring_records" (
  "id" TEXT NOT NULL,
  "import_job_id" TEXT,
  "debtor_id" TEXT,
  "contract_id" TEXT,
  "period_month" TEXT NOT NULL,
  "restructuring_date" TIMESTAMP(3),
  "restructuring_type" TEXT,
  "reason" TEXT,
  "plafond_after" DECIMAL(18,2),
  "outstanding_after" DECIMAL(18,2),
  "tenor_after" INTEGER,
  "new_due_date" TIMESTAMP(3),
  "collectibility_before" TEXT,
  "collectibility_after" TEXT,
  "status" TEXT NOT NULL DEFAULT 'AKTIF',
  "description" TEXT,
  "raw_data" JSONB,
  "row_hash" TEXT NOT NULL,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "debtor_restructuring_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "debtor_restructuring_records_period_month_row_hash_key"
  ON "debtor_restructuring_records"("period_month", "row_hash");

CREATE INDEX "debtor_restructuring_records_import_job_id_idx"
  ON "debtor_restructuring_records"("import_job_id");

CREATE INDEX "debtor_restructuring_records_debtor_id_idx"
  ON "debtor_restructuring_records"("debtor_id");

CREATE INDEX "debtor_restructuring_records_contract_id_idx"
  ON "debtor_restructuring_records"("contract_id");

CREATE INDEX "debtor_restructuring_records_period_month_idx"
  ON "debtor_restructuring_records"("period_month");

CREATE INDEX "debtor_restructuring_records_status_idx"
  ON "debtor_restructuring_records"("status");

CREATE INDEX "debtor_restructuring_records_deleted_at_idx"
  ON "debtor_restructuring_records"("deleted_at");

ALTER TABLE "debtor_restructuring_records"
  ADD CONSTRAINT "debtor_restructuring_records_import_job_id_fkey"
  FOREIGN KEY ("import_job_id") REFERENCES "debtor_import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debtor_restructuring_records"
  ADD CONSTRAINT "debtor_restructuring_records_debtor_id_fkey"
  FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debtor_restructuring_records"
  ADD CONSTRAINT "debtor_restructuring_records_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
