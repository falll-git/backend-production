CREATE TYPE "watermark_policy_modes" AS ENUM ('INHERIT', 'FORCE_ON', 'FORCE_OFF');
CREATE TYPE "watermark_statuses" AS ENUM ('PENDING', 'PROCESSING', 'APPLIED', 'SKIPPED', 'FAILED', 'UNSUPPORTED');

ALTER TABLE "digital_documents"
  ADD COLUMN "watermark_policy" "watermark_policy_modes" NOT NULL DEFAULT 'INHERIT',
  ADD COLUMN "watermark_status" "watermark_statuses" NOT NULL DEFAULT 'SKIPPED',
  ADD COLUMN "watermark_file" TEXT,
  ADD COLUMN "watermark_source_path" TEXT,
  ADD COLUMN "watermark_settings_hash" TEXT,
  ADD COLUMN "watermark_error_message" TEXT,
  ADD COLUMN "watermark_requested_at" TIMESTAMP(3),
  ADD COLUMN "watermark_applied_at" TIMESTAMP(3);

ALTER TABLE "incoming_mails"
  ADD COLUMN "watermark_policy" "watermark_policy_modes" NOT NULL DEFAULT 'INHERIT',
  ADD COLUMN "watermark_status" "watermark_statuses" NOT NULL DEFAULT 'SKIPPED',
  ADD COLUMN "watermark_file" TEXT,
  ADD COLUMN "watermark_source_path" TEXT,
  ADD COLUMN "watermark_settings_hash" TEXT,
  ADD COLUMN "watermark_error_message" TEXT,
  ADD COLUMN "watermark_requested_at" TIMESTAMP(3),
  ADD COLUMN "watermark_applied_at" TIMESTAMP(3);

ALTER TABLE "outgoing_mails"
  ADD COLUMN "watermark_policy" "watermark_policy_modes" NOT NULL DEFAULT 'INHERIT',
  ADD COLUMN "watermark_status" "watermark_statuses" NOT NULL DEFAULT 'SKIPPED',
  ADD COLUMN "watermark_file" TEXT,
  ADD COLUMN "watermark_source_path" TEXT,
  ADD COLUMN "watermark_settings_hash" TEXT,
  ADD COLUMN "watermark_error_message" TEXT,
  ADD COLUMN "watermark_requested_at" TIMESTAMP(3),
  ADD COLUMN "watermark_applied_at" TIMESTAMP(3);

ALTER TABLE "memorandums"
  ADD COLUMN "watermark_policy" "watermark_policy_modes" NOT NULL DEFAULT 'INHERIT',
  ADD COLUMN "watermark_status" "watermark_statuses" NOT NULL DEFAULT 'SKIPPED',
  ADD COLUMN "watermark_file" TEXT,
  ADD COLUMN "watermark_source_path" TEXT,
  ADD COLUMN "watermark_settings_hash" TEXT,
  ADD COLUMN "watermark_error_message" TEXT,
  ADD COLUMN "watermark_requested_at" TIMESTAMP(3),
  ADD COLUMN "watermark_applied_at" TIMESTAMP(3);

CREATE INDEX "digital_documents_watermark_policy_idx" ON "digital_documents"("watermark_policy");
CREATE INDEX "digital_documents_watermark_status_idx" ON "digital_documents"("watermark_status");
CREATE INDEX "incoming_mails_watermark_policy_idx" ON "incoming_mails"("watermark_policy");
CREATE INDEX "incoming_mails_watermark_status_idx" ON "incoming_mails"("watermark_status");
CREATE INDEX "outgoing_mails_watermark_policy_idx" ON "outgoing_mails"("watermark_policy");
CREATE INDEX "outgoing_mails_watermark_status_idx" ON "outgoing_mails"("watermark_status");
CREATE INDEX "memorandums_watermark_policy_idx" ON "memorandums"("watermark_policy");
CREATE INDEX "memorandums_watermark_status_idx" ON "memorandums"("watermark_status");
