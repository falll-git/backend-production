CREATE TABLE "storage_usage_daily_snapshots" (
    "id" TEXT NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "used_bytes" BIGINT NOT NULL DEFAULT 0,
    "used_gb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'database_file_size',
    "is_estimated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_usage_daily_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storage_usage_daily_snapshots_snapshot_date_key" ON "storage_usage_daily_snapshots"("snapshot_date");
CREATE INDEX "storage_usage_daily_snapshots_snapshot_date_idx" ON "storage_usage_daily_snapshots"("snapshot_date");
CREATE INDEX "storage_usage_daily_snapshots_is_estimated_idx" ON "storage_usage_daily_snapshots"("is_estimated");
