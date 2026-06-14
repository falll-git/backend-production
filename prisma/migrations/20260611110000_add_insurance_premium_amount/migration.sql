ALTER TABLE "legal_insurance_progress"
  ADD COLUMN "premium_amount" DECIMAL(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE "legal_insurance_progress"
  ALTER COLUMN "status" SET DEFAULT 'AKTIF';
