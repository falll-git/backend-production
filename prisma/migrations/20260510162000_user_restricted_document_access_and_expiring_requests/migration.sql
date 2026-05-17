DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'is_restrict'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'can_access_restricted_documents'
  ) THEN
    ALTER TABLE "users"
      RENAME COLUMN "is_restrict" TO "can_access_restricted_documents";
  ELSIF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'can_access_restricted_documents'
  ) THEN
    ALTER TABLE "users"
      ADD COLUMN "can_access_restricted_documents" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

ALTER TABLE "users"
  ALTER COLUMN "can_access_restricted_documents" SET DEFAULT false;

UPDATE "users"
SET "can_access_restricted_documents" = false
WHERE "can_access_restricted_documents" IS NULL;

ALTER TABLE "users"
  ALTER COLUMN "can_access_restricted_documents" SET NOT NULL;

UPDATE "digital_document_access_requests"
SET "expires_at" = COALESCE("expires_at", CURRENT_TIMESTAMP + INTERVAL '7 days')
WHERE "expires_at" IS NULL;

ALTER TABLE "digital_document_access_requests"
  ALTER COLUMN "expires_at" SET NOT NULL;

DROP INDEX IF EXISTS "digital_document_access_requests_active_approved_key";

CREATE INDEX IF NOT EXISTS "digital_document_access_requests_document_requester_status_expires_idx"
  ON "digital_document_access_requests"("document_id", "requester_id", "status", "expires_at");
