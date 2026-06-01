CREATE TABLE IF NOT EXISTS "debtor_contract_slik_snapshots" (
  "id" TEXT NOT NULL,
  "debtor_id" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "period_month" TEXT NOT NULL,
  "facility_number" TEXT NOT NULL,
  "debtor_number" TEXT,
  "credit_nature_code" TEXT,
  "credit_type_code" TEXT,
  "financing_scheme_code" TEXT,
  "initial_akad_number" TEXT,
  "initial_akad_date" TIMESTAMP(3),
  "final_akad_number" TEXT,
  "final_akad_date" TIMESTAMP(3),
  "new_or_extension_code" TEXT,
  "credit_start_date" TIMESTAMP(3),
  "start_date" TIMESTAMP(3),
  "due_date" TIMESTAMP(3),
  "debtor_category_code" TEXT,
  "usage_type_code" TEXT,
  "usage_orientation_code" TEXT,
  "economic_sector_code" TEXT,
  "project_location_city_code" TEXT,
  "project_value" DECIMAL(18,2),
  "currency_code" TEXT,
  "interest_rate" DECIMAL(12,6),
  "interest_type_code" TEXT,
  "government_program_code" TEXT,
  "takeover_from" TEXT,
  "source_of_funds_code" TEXT,
  "initial_plafond" DECIMAL(18,2),
  "plafond" DECIMAL(18,2),
  "current_month_disbursement" DECIMAL(18,2),
  "penalty" DECIMAL(18,2),
  "baki_debet" DECIMAL(18,2),
  "original_currency_amount" DECIMAL(18,2),
  "collectibility_code" TEXT,
  "default_date" TIMESTAMP(3),
  "default_reason_code" TEXT,
  "principal_arrears" DECIMAL(18,2),
  "margin_arrears" DECIMAL(18,2),
  "days_past_due" INTEGER,
  "arrears_frequency" INTEGER,
  "restructuring_frequency" INTEGER,
  "initial_restructuring_date" TIMESTAMP(3),
  "final_restructuring_date" TIMESTAMP(3),
  "restructuring_method_code" TEXT,
  "condition_code" TEXT,
  "condition_date" TIMESTAMP(3),
  "description" TEXT,
  "branch_code" TEXT,
  "operation_code" TEXT,
  "raw_data" JSONB,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "debtor_contract_slik_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "debtor_contract_slik_snapshots_contract_id_period_month_key"
  ON "debtor_contract_slik_snapshots"("contract_id", "period_month");
CREATE INDEX IF NOT EXISTS "debtor_contract_slik_snapshots_debtor_id_idx"
  ON "debtor_contract_slik_snapshots"("debtor_id");
CREATE INDEX IF NOT EXISTS "debtor_contract_slik_snapshots_period_month_idx"
  ON "debtor_contract_slik_snapshots"("period_month");
CREATE INDEX IF NOT EXISTS "debtor_contract_slik_snapshots_facility_number_idx"
  ON "debtor_contract_slik_snapshots"("facility_number");
CREATE INDEX IF NOT EXISTS "debtor_contract_slik_snapshots_collectibility_code_idx"
  ON "debtor_contract_slik_snapshots"("collectibility_code");
CREATE INDEX IF NOT EXISTS "debtor_contract_slik_snapshots_deleted_at_idx"
  ON "debtor_contract_slik_snapshots"("deleted_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'debtor_contract_slik_snapshots_debtor_id_fkey'
  ) THEN
    ALTER TABLE "debtor_contract_slik_snapshots"
      ADD CONSTRAINT "debtor_contract_slik_snapshots_debtor_id_fkey"
      FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'debtor_contract_slik_snapshots_contract_id_fkey'
  ) THEN
    ALTER TABLE "debtor_contract_slik_snapshots"
      ADD CONSTRAINT "debtor_contract_slik_snapshots_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "debtor_collaterals"
  ADD COLUMN IF NOT EXISTS "facility_segment_code" TEXT,
  ADD COLUMN IF NOT EXISTS "collateral_status_code" TEXT,
  ADD COLUMN IF NOT EXISTS "rating" TEXT,
  ADD COLUMN IF NOT EXISTS "rating_agency_code" TEXT,
  ADD COLUMN IF NOT EXISTS "binding_type_code" TEXT,
  ADD COLUMN IF NOT EXISTS "binding_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "location_city_code" TEXT,
  ADD COLUMN IF NOT EXISTS "reporter_appraisal_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "independent_appraisal_value" DECIMAL(18,2),
  ADD COLUMN IF NOT EXISTS "independent_appraiser_name" TEXT,
  ADD COLUMN IF NOT EXISTS "independent_appraisal_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paripasu_status" TEXT,
  ADD COLUMN IF NOT EXISTS "paripasu_percentage" DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS "joint_credit_status" TEXT,
  ADD COLUMN IF NOT EXISTS "insured_status" TEXT,
  ADD COLUMN IF NOT EXISTS "branch_code" TEXT,
  ADD COLUMN IF NOT EXISTS "operation_code" TEXT;
