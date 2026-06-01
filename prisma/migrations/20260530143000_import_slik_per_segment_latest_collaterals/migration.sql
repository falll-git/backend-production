ALTER TABLE "debtor_import_jobs"
ADD COLUMN IF NOT EXISTS "import_segment" TEXT,
ADD COLUMN IF NOT EXISTS "cif_status" TEXT;

ALTER TABLE "debtor_collaterals"
ADD COLUMN IF NOT EXISTS "last_import_period_month" TEXT;

UPDATE "debtor_collaterals"
SET "last_import_period_month" = COALESCE("last_import_period_month", "period_month")
WHERE "last_import_period_month" IS NULL;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "collateral_number", COALESCE("facility_number", '')
      ORDER BY
        "last_import_period_month" DESC NULLS LAST,
        "period_month" DESC NULLS LAST,
        "updated_at" DESC,
        "created_at" DESC,
        "id" DESC
    ) AS rn
  FROM "debtor_collaterals"
  WHERE "deleted_at" IS NULL
)
UPDATE "debtor_collaterals" dc
SET
  "deleted_at" = NOW(),
  "deleted_by" = COALESCE("deleted_by", 'migration:dedupe-a01-latest')
FROM ranked
WHERE dc."id" = ranked."id"
  AND ranked.rn > 1;

ALTER TABLE "debtor_collaterals"
DROP CONSTRAINT IF EXISTS "debtor_collaterals_collateral_number_period_month_key";

CREATE INDEX IF NOT EXISTS "debtor_collaterals_collateral_number_facility_number_idx"
ON "debtor_collaterals"("collateral_number", "facility_number");

CREATE UNIQUE INDEX IF NOT EXISTS "debtor_collaterals_active_collateral_facility_uidx"
ON "debtor_collaterals"("collateral_number", COALESCE("facility_number", ''))
WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "debtor_contract_slik_snapshots_facility_number_period_month_key"
ON "debtor_contract_slik_snapshots"("facility_number", "period_month");
