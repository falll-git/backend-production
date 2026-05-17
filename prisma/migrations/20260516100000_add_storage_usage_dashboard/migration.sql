ALTER TABLE "digital_documents"
ADD COLUMN "watermark_file_size_bytes" INTEGER;

ALTER TABLE "incoming_mails"
ADD COLUMN "file_size_bytes" INTEGER,
ADD COLUMN "watermark_file_size_bytes" INTEGER;

ALTER TABLE "outgoing_mails"
ADD COLUMN "file_size_bytes" INTEGER,
ADD COLUMN "watermark_file_size_bytes" INTEGER;

ALTER TABLE "memorandums"
ADD COLUMN "file_size_bytes" INTEGER,
ADD COLUMN "watermark_file_size_bytes" INTEGER;

CREATE TABLE "storage_usage_configs" (
    "id" TEXT NOT NULL,
    "free_quota_gb" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "overage_price_per_gb" DECIMAL(12,6) NOT NULL DEFAULT 0.0023,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_usage_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "storage_usage_configs_is_active_idx" ON "storage_usage_configs"("is_active");

INSERT INTO "storage_usage_configs" (
    "id",
    "free_quota_gb",
    "overage_price_per_gb",
    "currency",
    "is_active"
)
VALUES (
    'storage-usage-config-default',
    500,
    0.0023,
    'USD',
    true
);
