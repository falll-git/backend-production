-- Auth/onboarding contract
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_onboarding_statuses') THEN
    CREATE TYPE "user_onboarding_statuses" AS ENUM ('NOT_ACTIVATED', 'PENDING_ACTIVATION', 'ACTIVE');
  END IF;
END $$;

ALTER TYPE "auth_action_token_types" ADD VALUE IF NOT EXISTS 'ACTIVATION';
ALTER TYPE "auth_action_token_types" ADD VALUE IF NOT EXISTS 'SET_PASSWORD';

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "onboarding_status" "user_onboarding_statuses" NOT NULL DEFAULT 'NOT_ACTIVATED',
  ADD COLUMN IF NOT EXISTS "refresh_token_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "invited_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "activated_at" TIMESTAMP(3);

UPDATE "users" u
SET
  "onboarding_status" = CASE
    WHEN u."password_set_at" IS NOT NULL THEN 'ACTIVE'::"user_onboarding_statuses"
    WHEN EXISTS (
      SELECT 1
      FROM "auth_action_tokens" t
      WHERE t."user_id" = u."id"
        AND t."used_at" IS NULL
        AND t."expires_at" > CURRENT_TIMESTAMP
        AND t."type"::TEXT IN ('INVITE', 'ACTIVATION', 'SET_PASSWORD')
    ) THEN 'PENDING_ACTIVATION'::"user_onboarding_statuses"
    ELSE 'NOT_ACTIVATED'::"user_onboarding_statuses"
  END,
  "activated_at" = CASE
    WHEN u."password_set_at" IS NOT NULL THEN COALESCE(u."activated_at", u."password_set_at", u."email_verified_at")
    ELSE u."activated_at"
  END;

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id", "revoked_at");
CREATE INDEX IF NOT EXISTS "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refresh_tokens_user_id_fkey') THEN
    ALTER TABLE "refresh_tokens"
      ADD CONSTRAINT "refresh_tokens_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Masterdata business keys
CREATE UNIQUE INDEX IF NOT EXISTS "roles_name_key" ON "roles"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "roles_name_lower_key" ON "roles"(LOWER(BTRIM("name")));

CREATE UNIQUE INDEX IF NOT EXISTS "divisions_name_key" ON "divisions"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "divisions_name_lower_key" ON "divisions"(LOWER(BTRIM("name")));

CREATE UNIQUE INDEX IF NOT EXISTS "letter_priorities_name_key" ON "letter_priorities"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "letter_priorities_name_lower_key" ON "letter_priorities"(LOWER(BTRIM("name")));

CREATE UNIQUE INDEX IF NOT EXISTS "document_types_code_key" ON "document_types"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "document_types_code_lower_key" ON "document_types"(LOWER(BTRIM("code")));
CREATE UNIQUE INDEX IF NOT EXISTS "document_types_name_key" ON "document_types"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "document_types_name_lower_key" ON "document_types"(LOWER(BTRIM("name")));

-- Relational menu tree and role menu lifecycle
UPDATE "menus"
SET "url" = ''
WHERE "url" IS NULL;

ALTER TABLE "menus"
  ALTER COLUMN "url" SET DEFAULT '',
  ALTER COLUMN "url" SET NOT NULL,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);

UPDATE "menus"
SET "updated_at" = COALESCE("updated_at", "created_at", CURRENT_TIMESTAMP);

ALTER TABLE "menus"
  ALTER COLUMN "updated_at" SET NOT NULL;

UPDATE "menus" m
SET "parent_id" = NULL
WHERE m."parent_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "menus" p
    WHERE p."id" = m."parent_id"
  );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menus_parent_id_fkey') THEN
    ALTER TABLE "menus"
      ADD CONSTRAINT "menus_parent_id_fkey"
      FOREIGN KEY ("parent_id") REFERENCES "menus"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "menus_parent_id_idx" ON "menus"("parent_id");
CREATE INDEX IF NOT EXISTS "menus_order_idx" ON "menus"("order");

ALTER TABLE "role_menus"
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);

UPDATE "role_menus"
SET "updated_at" = COALESCE("updated_at", "created_at", CURRENT_TIMESTAMP);

ALTER TABLE "role_menus"
  ALTER COLUMN "updated_at" SET NOT NULL;

-- Storage hardening
ALTER TABLE "storages"
  ALTER COLUMN "capacity" TYPE INTEGER
  USING CASE
    WHEN "capacity" IS NULL THEN NULL
    WHEN BTRIM("capacity"::TEXT) ~ '^[0-9]+$' THEN BTRIM("capacity"::TEXT)::INTEGER
    ELSE NULL
  END;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storages_capacity_nonnegative_check') THEN
    ALTER TABLE "storages"
      ADD CONSTRAINT "storages_capacity_nonnegative_check"
      CHECK ("capacity" IS NULL OR "capacity" >= 0);
  END IF;
END $$;

-- Correspondence status/media enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mail_workflow_statuses') THEN
    CREATE TYPE "mail_workflow_statuses" AS ENUM ('NEW', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'outgoing_mail_statuses') THEN
    CREATE TYPE "outgoing_mail_statuses" AS ENUM ('ACTIVE', 'INACTIVE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'outgoing_mail_delivery_media') THEN
    CREATE TYPE "outgoing_mail_delivery_media" AS ENUM ('email', 'pos', 'kurir', 'langsung');
  END IF;
END $$;

ALTER TABLE "incoming_mails"
  ADD COLUMN IF NOT EXISTS "created_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_by" TEXT,
  ADD COLUMN IF NOT EXISTS "deleted_by" TEXT,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

UPDATE "incoming_mails"
SET "regarding" = COALESCE(NULLIF(BTRIM("regarding"), ''), '(tanpa perihal)')
WHERE "regarding" IS NULL OR BTRIM("regarding") = '';

ALTER TABLE "incoming_mails"
  ALTER COLUMN "regarding" SET NOT NULL,
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "mail_workflow_statuses"
  USING CASE "status"::TEXT
    WHEN '1' THEN 'IN_PROGRESS'
    WHEN '2' THEN 'COMPLETED'
    WHEN '3' THEN 'OVERDUE'
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN 'COMPLETED' THEN 'COMPLETED'
    WHEN 'OVERDUE' THEN 'OVERDUE'
    ELSE 'NEW'
  END::"mail_workflow_statuses",
  ALTER COLUMN "status" SET DEFAULT 'NEW';

CREATE UNIQUE INDEX IF NOT EXISTS "incoming_mails_mail_number_key" ON "incoming_mails"("mail_number");
CREATE INDEX IF NOT EXISTS "incoming_mails_letter_prioritie_id_idx" ON "incoming_mails"("letter_prioritie_id");
CREATE INDEX IF NOT EXISTS "incoming_mails_division_id_idx" ON "incoming_mails"("division_id");
CREATE INDEX IF NOT EXISTS "incoming_mails_status_idx" ON "incoming_mails"("status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incoming_mails_created_by_fkey') THEN
    ALTER TABLE "incoming_mails" ADD CONSTRAINT "incoming_mails_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incoming_mails_updated_by_fkey') THEN
    ALTER TABLE "incoming_mails" ADD CONSTRAINT "incoming_mails_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incoming_mails_deleted_by_fkey') THEN
    ALTER TABLE "incoming_mails" ADD CONSTRAINT "incoming_mails_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "outgoing_mails"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "outgoing_mail_statuses"
  USING CASE "status"::TEXT
    WHEN '0' THEN 'INACTIVE'
    WHEN 'INACTIVE' THEN 'INACTIVE'
    ELSE 'ACTIVE'
  END::"outgoing_mail_statuses",
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE',
  ALTER COLUMN "delivery_media" TYPE "outgoing_mail_delivery_media"
  USING CASE LOWER(BTRIM("delivery_media"::TEXT))
    WHEN 'email' THEN 'email'
    WHEN 'pos' THEN 'pos'
    WHEN 'kurir' THEN 'kurir'
    WHEN 'langsung' THEN 'langsung'
    ELSE 'langsung'
  END::"outgoing_mail_delivery_media";

CREATE UNIQUE INDEX IF NOT EXISTS "outgoing_mails_mail_number_key" ON "outgoing_mails"("mail_number");
CREATE INDEX IF NOT EXISTS "outgoing_mails_letter_prioritie_id_idx" ON "outgoing_mails"("letter_prioritie_id");
CREATE INDEX IF NOT EXISTS "outgoing_mails_status_idx" ON "outgoing_mails"("status");

UPDATE "memorandums"
SET "regarding" = COALESCE(NULLIF(BTRIM("regarding"), ''), '(tanpa perihal)')
WHERE "regarding" IS NULL OR BTRIM("regarding") = '';

ALTER TABLE "memorandums"
  ALTER COLUMN "regarding" SET NOT NULL,
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "mail_workflow_statuses"
  USING CASE "status"::TEXT
    WHEN '1' THEN 'IN_PROGRESS'
    WHEN '2' THEN 'COMPLETED'
    WHEN '3' THEN 'OVERDUE'
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN 'COMPLETED' THEN 'COMPLETED'
    WHEN 'OVERDUE' THEN 'OVERDUE'
    ELSE 'NEW'
  END::"mail_workflow_statuses",
  ALTER COLUMN "status" SET DEFAULT 'NEW';

CREATE UNIQUE INDEX IF NOT EXISTS "memorandums_memo_number_key" ON "memorandums"("memo_number");
CREATE INDEX IF NOT EXISTS "memorandums_division_id_idx" ON "memorandums"("division_id");
CREATE INDEX IF NOT EXISTS "memorandums_status_idx" ON "memorandums"("status");

-- Disposition lifecycle fields
ALTER TABLE "incoming_mail_dispositions"
  ADD COLUMN IF NOT EXISTS "acted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);

UPDATE "incoming_mail_dispositions"
SET "updated_at" = COALESCE("updated_at", "created_at", "disposed_at", CURRENT_TIMESTAMP);

ALTER TABLE "incoming_mail_dispositions"
  ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "memorandum_dispositions"
  ADD COLUMN IF NOT EXISTS "acted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);

UPDATE "memorandum_dispositions"
SET "updated_at" = COALESCE("updated_at", "created_at", "disposed_at", CURRENT_TIMESTAMP);

ALTER TABLE "memorandum_dispositions"
  ALTER COLUMN "updated_at" SET NOT NULL;

-- Digital archive access level, files, and active-process constraints
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'digital_document_access_levels') THEN
    CREATE TYPE "digital_document_access_levels" AS ENUM ('NON_RESTRICT', 'RESTRICT');
  END IF;
END $$;

ALTER TABLE "digital_documents"
  ADD COLUMN IF NOT EXISTS "access_level" "digital_document_access_levels" NOT NULL DEFAULT 'NON_RESTRICT';

UPDATE "digital_documents"
SET "access_level" = CASE
  WHEN "is_restricted" THEN 'RESTRICT'::"digital_document_access_levels"
  ELSE 'NON_RESTRICT'::"digital_document_access_levels"
END;

CREATE INDEX IF NOT EXISTS "digital_documents_storage_id_idx" ON "digital_documents"("storage_id");
CREATE INDEX IF NOT EXISTS "digital_documents_document_type_id_idx" ON "digital_documents"("document_type_id");
CREATE INDEX IF NOT EXISTS "digital_documents_created_by_idx" ON "digital_documents"("created_by");
CREATE INDEX IF NOT EXISTS "digital_documents_access_level_idx" ON "digital_documents"("access_level");

CREATE TABLE IF NOT EXISTS "document_files" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "uploaded_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "document_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_files_document_id_file_path_key" ON "document_files"("document_id", "file_path");
CREATE UNIQUE INDEX IF NOT EXISTS "document_files_one_primary_per_document_key" ON "document_files"("document_id") WHERE "is_primary" = true AND "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "document_files_document_id_is_primary_idx" ON "document_files"("document_id", "is_primary");
CREATE INDEX IF NOT EXISTS "document_files_uploaded_by_idx" ON "document_files"("uploaded_by");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_files_document_id_fkey') THEN
    ALTER TABLE "document_files"
      ADD CONSTRAINT "document_files_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "digital_documents"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_files_uploaded_by_fkey') THEN
    ALTER TABLE "document_files"
      ADD CONSTRAINT "document_files_uploaded_by_fkey"
      FOREIGN KEY ("uploaded_by") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "document_files" (
  "id",
  "document_id",
  "file_path",
  "file_name",
  "is_primary",
  "uploaded_by",
  "created_at",
  "updated_at"
)
SELECT
  'file_' || MD5(d."id" || '::primary'),
  d."id",
  d."file",
  d."file",
  true,
  d."created_by",
  d."created_at",
  d."updated_at"
FROM "digital_documents" d
WHERE d."file" IS NOT NULL
  AND BTRIM(d."file") <> ''
ON CONFLICT ("document_id", "file_path") DO NOTHING;

ALTER TABLE "digital_document_access_requests"
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expired_at" TIMESTAMP(3);

UPDATE "digital_document_access_requests"
SET "approved_at" = COALESCE("approved_at", "acted_at")
WHERE "status" = 'APPROVED' AND "acted_at" IS NOT NULL;

UPDATE "digital_document_access_requests"
SET "rejected_at" = COALESCE("rejected_at", "acted_at")
WHERE "status" = 'REJECTED' AND "acted_at" IS NOT NULL;

UPDATE "digital_document_access_requests"
SET "expired_at" = COALESCE("expired_at", "expires_at")
WHERE "status" = 'APPROVED'
  AND "expires_at" IS NOT NULL
  AND "expires_at" < CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "digital_document_access_requests_status_expires_at_idx" ON "digital_document_access_requests"("status", "expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "digital_document_access_requests_active_pending_key"
  ON "digital_document_access_requests"("document_id", "requester_id")
  WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS "digital_document_access_requests_active_approved_key"
  ON "digital_document_access_requests"("document_id", "requester_id")
  WHERE "status" = 'APPROVED' AND "expired_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "digital_document_loans_active_document_key"
  ON "digital_document_loans"("document_id")
  WHERE "status" IN ('PENDING', 'APPROVED', 'BORROWED');

-- Storage activity logs: preserve the Prisma model name for backend compatibility, map DB table to storage_activity_logs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'digital_document_activity_actions')
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_activity_actions') THEN
    ALTER TYPE "digital_document_activity_actions" RENAME TO "storage_activity_actions";
  ELSIF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_activity_actions') THEN
    CREATE TYPE "storage_activity_actions" AS ENUM (
      'CREATED',
      'UPDATED',
      'STORAGE_MOVED',
      'DELETED',
      'ACCESS_REQUESTED',
      'ACCESS_APPROVED',
      'ACCESS_REJECTED',
      'LOAN_REQUESTED',
      'LOAN_APPROVED',
      'LOAN_REJECTED',
      'LOAN_HANDED_OVER',
      'LOAN_RETURNED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"digital_document_activity_logs"') IS NOT NULL
     AND to_regclass('"storage_activity_logs"') IS NULL THEN
    ALTER TABLE "digital_document_activity_logs" RENAME TO "storage_activity_logs";
  END IF;
END $$;

ALTER INDEX IF EXISTS "digital_document_activity_logs_pkey" RENAME TO "storage_activity_logs_pkey";
ALTER INDEX IF EXISTS "digital_document_activity_logs_document_id_created_at_idx" RENAME TO "storage_activity_logs_document_id_created_at_idx";
ALTER INDEX IF EXISTS "digital_document_activity_logs_action_created_at_idx" RENAME TO "storage_activity_logs_action_created_at_idx";
ALTER INDEX IF EXISTS "digital_document_activity_logs_from_storage_id_idx" RENAME TO "storage_activity_logs_from_storage_id_idx";
ALTER INDEX IF EXISTS "digital_document_activity_logs_to_storage_id_idx" RENAME TO "storage_activity_logs_to_storage_id_idx";
