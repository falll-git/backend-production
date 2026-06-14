ALTER TABLE "legal_deposit_transactions"
  ADD COLUMN "file_path" TEXT,
  ADD COLUMN "file_name" TEXT,
  ADD COLUMN "mime_type" TEXT,
  ADD COLUMN "size_bytes" INTEGER;

CREATE TEMP TABLE "_legacy_deposit_backfill" AS
  SELECT
    d."id",
    d."nominal",
    d."paid_amount",
    d."processed_amount",
    d."created_by",
    d."created_at"
  FROM "legal_deposits" d
  WHERE d."deleted_at" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "legal_deposit_transactions" t
      WHERE t."deposit_id" = d."id"
    );

INSERT INTO "legal_deposit_transactions" (
  "id",
  "deposit_id",
  "transaction_date",
  "action",
  "amount",
  "notes",
  "created_by",
  "created_at"
)
SELECT
  md5("id" || ':TITIPAN:legacy'),
  "id",
  COALESCE("created_at", CURRENT_TIMESTAMP),
  'TITIPAN',
  "nominal",
  'Migrasi saldo awal dana titipan legacy.',
  COALESCE("created_by", 'migration:legal-deposit-ledger'),
  CURRENT_TIMESTAMP
FROM "_legacy_deposit_backfill"
WHERE "nominal" > 0;

INSERT INTO "legal_deposit_transactions" (
  "id",
  "deposit_id",
  "transaction_date",
  "action",
  "amount",
  "notes",
  "created_by",
  "created_at"
)
SELECT
  md5("id" || ':PEMBAYARAN:legacy'),
  "id",
  COALESCE("created_at", CURRENT_TIMESTAMP),
  'PEMBAYARAN',
  COALESCE("paid_amount", 0),
  'Migrasi pembayaran legacy dana titipan.',
  COALESCE("created_by", 'migration:legal-deposit-ledger'),
  CURRENT_TIMESTAMP
FROM "_legacy_deposit_backfill"
WHERE COALESCE("paid_amount", 0) > 0;

INSERT INTO "legal_deposit_transactions" (
  "id",
  "deposit_id",
  "transaction_date",
  "action",
  "amount",
  "notes",
  "created_by",
  "created_at"
)
SELECT
  md5("id" || ':REFUND:legacy'),
  "id",
  COALESCE("created_at", CURRENT_TIMESTAMP),
  'REFUND',
  "processed_amount",
  'Migrasi refund legacy dana titipan.',
  COALESCE("created_by", 'migration:legal-deposit-ledger'),
  CURRENT_TIMESTAMP
FROM "_legacy_deposit_backfill"
WHERE COALESCE("processed_amount", 0) > 0;

DROP TABLE "_legacy_deposit_backfill";

WITH totals AS (
  SELECT
    d."id",
    COALESCE(SUM(CASE WHEN t."action" = 'TITIPAN' THEN t."amount" ELSE 0 END), 0) AS total_titipan,
    COALESCE(SUM(
      CASE
        WHEN t."action" IN ('PEMBAYARAN', 'BAYAR', 'PAID', 'PROSES', 'PROCESS', 'KOREKSI')
        THEN t."amount"
        ELSE 0
      END
    ), 0) AS total_pembayaran,
    COALESCE(SUM(CASE WHEN t."action" = 'REFUND' THEN t."amount" ELSE 0 END), 0) AS total_refund
  FROM "legal_deposits" d
  LEFT JOIN "legal_deposit_transactions" t ON t."deposit_id" = d."id"
  WHERE d."deleted_at" IS NULL
  GROUP BY d."id"
)
UPDATE "legal_deposits" d
SET
  "nominal" = totals.total_titipan,
  "paid_amount" = totals.total_pembayaran,
  "processed_amount" = totals.total_refund,
  "remaining_amount" = GREATEST(totals.total_titipan - totals.total_pembayaran - totals.total_refund, 0),
  "status" = CASE
    WHEN totals.total_titipan = 0 AND totals.total_pembayaran = 0 AND totals.total_refund = 0 THEN 'PENDING'
    WHEN totals.total_titipan - totals.total_pembayaran - totals.total_refund > 0 THEN 'AKTIF'
    ELSE 'SELESAI'
  END
FROM totals
WHERE d."id" = totals."id";

INSERT INTO "deposit_types" (
  "id",
  "code",
  "name",
  "category",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  md5('deposit_type:LAINNYA'),
  'LAINNYA',
  'Titipan Lainnya',
  'LAINNYA',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "deposit_types" WHERE "code" = 'LAINNYA'
);
