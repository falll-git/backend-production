ALTER TABLE "debtor_collaterals"
  ADD COLUMN IF NOT EXISTS "expiry_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expiry_updated_by" TEXT,
  ADD COLUMN IF NOT EXISTS "expiry_updated_at" TIMESTAMP(3);
