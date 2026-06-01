ALTER TABLE "legal_ideb_uploads" RENAME TO "debtor_ideb_uploads";

ALTER TABLE "debtor_ideb_uploads" RENAME CONSTRAINT "legal_ideb_uploads_pkey" TO "debtor_ideb_uploads_pkey";
ALTER TABLE "debtor_ideb_uploads" RENAME CONSTRAINT "legal_ideb_uploads_debtor_id_fkey" TO "debtor_ideb_uploads_debtor_id_fkey";
ALTER TABLE "debtor_ideb_uploads" RENAME CONSTRAINT "legal_ideb_uploads_contract_id_fkey" TO "debtor_ideb_uploads_contract_id_fkey";

ALTER INDEX "legal_ideb_uploads_debtor_id_idx" RENAME TO "debtor_ideb_uploads_debtor_id_idx";
ALTER INDEX "legal_ideb_uploads_contract_id_idx" RENAME TO "debtor_ideb_uploads_contract_id_idx";
ALTER INDEX "legal_ideb_uploads_year_month_idx" RENAME TO "debtor_ideb_uploads_year_month_idx";
ALTER INDEX "legal_ideb_uploads_status_idx" RENAME TO "debtor_ideb_uploads_status_idx";
ALTER INDEX "legal_ideb_uploads_deleted_at_idx" RENAME TO "debtor_ideb_uploads_deleted_at_idx";
