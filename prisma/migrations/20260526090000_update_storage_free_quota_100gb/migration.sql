ALTER TABLE "storage_usage_configs"
ALTER COLUMN "free_quota_gb" SET DEFAULT 100;

UPDATE "storage_usage_configs"
SET
  "free_quota_gb" = 100,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'storage-usage-config-default';
