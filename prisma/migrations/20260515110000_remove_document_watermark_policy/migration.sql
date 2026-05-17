DROP INDEX IF EXISTS "digital_documents_watermark_policy_idx";
DROP INDEX IF EXISTS "incoming_mails_watermark_policy_idx";
DROP INDEX IF EXISTS "outgoing_mails_watermark_policy_idx";
DROP INDEX IF EXISTS "memorandums_watermark_policy_idx";

ALTER TABLE "digital_documents" DROP COLUMN IF EXISTS "watermark_policy";
ALTER TABLE "incoming_mails" DROP COLUMN IF EXISTS "watermark_policy";
ALTER TABLE "outgoing_mails" DROP COLUMN IF EXISTS "watermark_policy";
ALTER TABLE "memorandums" DROP COLUMN IF EXISTS "watermark_policy";

DROP TYPE IF EXISTS "watermark_policy_modes";
