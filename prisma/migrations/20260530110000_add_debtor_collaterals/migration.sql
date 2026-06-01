CREATE TABLE IF NOT EXISTS "debtor_collaterals" (
  "id" TEXT NOT NULL,
  "debtor_id" TEXT,
  "contract_id" TEXT,
  "collateral_number" TEXT NOT NULL,
  "facility_number" TEXT,
  "collateral_type" TEXT,
  "owner_name" TEXT,
  "proof_number" TEXT,
  "address" TEXT,
  "market_value" DECIMAL(18,2),
  "appraisal_value" DECIMAL(18,2),
  "description" TEXT,
  "period_month" TEXT NOT NULL,
  "raw_data" JSONB,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debtor_collaterals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "debtor_collaterals_collateral_number_period_month_key"
  ON "debtor_collaterals"("collateral_number", "period_month");
CREATE INDEX IF NOT EXISTS "debtor_collaterals_debtor_id_idx"
  ON "debtor_collaterals"("debtor_id");
CREATE INDEX IF NOT EXISTS "debtor_collaterals_contract_id_idx"
  ON "debtor_collaterals"("contract_id");
CREATE INDEX IF NOT EXISTS "debtor_collaterals_facility_number_idx"
  ON "debtor_collaterals"("facility_number");
CREATE INDEX IF NOT EXISTS "debtor_collaterals_period_month_idx"
  ON "debtor_collaterals"("period_month");
CREATE INDEX IF NOT EXISTS "debtor_collaterals_deleted_at_idx"
  ON "debtor_collaterals"("deleted_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'debtor_collaterals_debtor_id_fkey'
  ) THEN
    ALTER TABLE "debtor_collaterals"
      ADD CONSTRAINT "debtor_collaterals_debtor_id_fkey"
      FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'debtor_collaterals_contract_id_fkey'
  ) THEN
    ALTER TABLE "debtor_collaterals"
      ADD CONSTRAINT "debtor_collaterals_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
