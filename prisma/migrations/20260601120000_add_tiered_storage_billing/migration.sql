ALTER TABLE "storage_usage_configs"
ADD COLUMN IF NOT EXISTS "billing_model" TEXT NOT NULL DEFAULT 'TIERED',
ADD COLUMN IF NOT EXISTS "pricing_tiers" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "manual_review_threshold_gb" DOUBLE PRECISION NOT NULL DEFAULT 1000;

ALTER TABLE "storage_usage_configs"
ALTER COLUMN "free_quota_gb" SET DEFAULT 100,
ALTER COLUMN "overage_price_per_gb" SET DEFAULT 200,
ALTER COLUMN "currency" SET DEFAULT 'IDR';

UPDATE "storage_usage_configs"
SET
  "free_quota_gb" = 100,
  "overage_price_per_gb" = 200,
  "currency" = 'IDR',
  "billing_model" = 'TIERED',
  "pricing_tiers" = '[
    {"from_gb": 0, "to_gb": 100, "price_per_gb": 0, "label": "0-100 GB", "description": "Gratis"},
    {"from_gb": 100, "to_gb": 500, "price_per_gb": 200, "label": "100-500 GB", "description": "Rp 200/GB/bulan"},
    {"from_gb": 500, "to_gb": 1000, "price_per_gb": 150, "label": "500-1000 GB", "description": "Rp 150/GB/bulan"}
  ]'::jsonb,
  "manual_review_threshold_gb" = 1000,
  "updated_at" = NOW()
WHERE "id" = 'storage-usage-config-default' OR "is_active" = true;
