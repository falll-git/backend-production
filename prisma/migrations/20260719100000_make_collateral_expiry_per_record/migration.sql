ALTER TABLE "debtor_collaterals"
ADD COLUMN "has_expiry_date" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "expiry_note" TEXT;

-- Hanya data yang memang sudah mempunyai tanggal manual yang dapat dipastikan
-- memiliki masa berlaku. Jenis agunan tidak dipakai untuk menebak status baris.
UPDATE "debtor_collaterals"
SET "has_expiry_date" = true
WHERE "expiry_date" IS NOT NULL;

ALTER TABLE "debtor_collaterals"
ADD CONSTRAINT "debtor_collaterals_expiry_consistency_check"
CHECK (
  ("has_expiry_date" = false AND "expiry_date" IS NULL)
  OR
  ("has_expiry_date" = true AND "expiry_date" IS NOT NULL)
);

UPDATE "debtor_collaterals" AS collateral
SET "expiry_updated_by" = NULL
WHERE "expiry_updated_by" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "users"
    WHERE "users"."id" = collateral."expiry_updated_by"
  );

ALTER TABLE "debtor_collaterals"
ADD CONSTRAINT "debtor_collaterals_expiry_updated_by_fkey"
FOREIGN KEY ("expiry_updated_by") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "debtor_collaterals_has_expiry_date_expiry_date_idx"
ON "debtor_collaterals"("has_expiry_date", "expiry_date");

CREATE INDEX "debtor_collaterals_expiry_updated_by_idx"
ON "debtor_collaterals"("expiry_updated_by");

ALTER TABLE "collateral_types"
DROP CONSTRAINT IF EXISTS "collateral_types_expiry_policy_check",
DROP COLUMN IF EXISTS "has_expiry_date",
DROP COLUMN IF EXISTS "expiry_warning_days";
