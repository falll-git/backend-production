ALTER TABLE "legal_deposit_transactions"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL_ENTRY';

UPDATE "legal_deposit_transactions"
SET "source" = 'LEGACY_MIGRATION'
WHERE "notes" IN (
  'Migrasi saldo awal dana titipan legacy.',
  'Migrasi pembayaran legacy dana titipan.',
  'Migrasi refund legacy dana titipan.'
);

UPDATE "legal_deposit_transactions" AS transaction
SET "source" = 'SYSTEM_IMPORT'
WHERE transaction."source" = 'MANUAL_ENTRY'
  AND EXISTS (
    SELECT 1
    FROM "legal_activity_logs" AS activity
    WHERE activity."deposit_transaction_id" = transaction."id"
      AND activity."source" NOT IN ('MANUAL', 'APPLICATION')
  );

WITH first_receipts AS (
  SELECT DISTINCT ON (transaction."deposit_id") transaction."id"
  FROM "legal_deposit_transactions" AS transaction
  WHERE UPPER(transaction."action") IN ('TITIPAN', 'PENERIMAAN')
    AND transaction."source" = 'MANUAL_ENTRY'
  ORDER BY
    transaction."deposit_id",
    transaction."transaction_date" ASC,
    transaction."created_at" ASC,
    transaction."id" ASC
)
UPDATE "legal_deposit_transactions" AS transaction
SET "source" = 'OPENING_BALANCE'
FROM first_receipts
WHERE transaction."id" = first_receipts."id";

CREATE INDEX "legal_deposit_transactions_source_idx"
ON "legal_deposit_transactions"("source");
