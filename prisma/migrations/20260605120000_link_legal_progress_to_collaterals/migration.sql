ALTER TABLE "legal_notary_progress"
  ADD COLUMN "collateral_id" TEXT;

ALTER TABLE "legal_insurance_progress"
  ADD COLUMN "collateral_id" TEXT;

ALTER TABLE "legal_kjpp_progress"
  ADD COLUMN "collateral_id" TEXT;

ALTER TABLE "legal_claims"
  ADD COLUMN "collateral_id" TEXT;

CREATE INDEX "legal_notary_progress_collateral_id_idx" ON "legal_notary_progress"("collateral_id");
CREATE INDEX "legal_insurance_progress_collateral_id_idx" ON "legal_insurance_progress"("collateral_id");
CREATE INDEX "legal_kjpp_progress_collateral_id_idx" ON "legal_kjpp_progress"("collateral_id");
CREATE INDEX "legal_claims_collateral_id_idx" ON "legal_claims"("collateral_id");

ALTER TABLE "legal_notary_progress"
  ADD CONSTRAINT "legal_notary_progress_collateral_id_fkey"
  FOREIGN KEY ("collateral_id") REFERENCES "debtor_collaterals"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legal_insurance_progress"
  ADD CONSTRAINT "legal_insurance_progress_collateral_id_fkey"
  FOREIGN KEY ("collateral_id") REFERENCES "debtor_collaterals"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legal_kjpp_progress"
  ADD CONSTRAINT "legal_kjpp_progress_collateral_id_fkey"
  FOREIGN KEY ("collateral_id") REFERENCES "debtor_collaterals"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legal_claims"
  ADD CONSTRAINT "legal_claims_collateral_id_fkey"
  FOREIGN KEY ("collateral_id") REFERENCES "debtor_collaterals"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
