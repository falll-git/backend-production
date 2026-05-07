
ALTER TABLE "dispositions"
  ADD COLUMN IF NOT EXISTS "due_date" INTEGER;

ALTER TABLE "role_menus"
  ADD COLUMN IF NOT EXISTS "can_create" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "can_read" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "can_update" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "can_delete" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "incoming_mail_dispositions"
  ALTER COLUMN "receiver_id" DROP DEFAULT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'digital_document_activity_logs_document_id_fkey'
      AND conrelid = 'storage_activity_logs'::regclass
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'storage_activity_logs_document_id_fkey'
      AND conrelid = 'storage_activity_logs'::regclass
  ) THEN
    ALTER TABLE "storage_activity_logs"
      RENAME CONSTRAINT "digital_document_activity_logs_document_id_fkey"
      TO "storage_activity_logs_document_id_fkey";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'digital_document_activity_logs_actor_id_fkey'
      AND conrelid = 'storage_activity_logs'::regclass
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'storage_activity_logs_actor_id_fkey'
      AND conrelid = 'storage_activity_logs'::regclass
  ) THEN
    ALTER TABLE "storage_activity_logs"
      RENAME CONSTRAINT "digital_document_activity_logs_actor_id_fkey"
      TO "storage_activity_logs_actor_id_fkey";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'digital_document_activity_logs_from_storage_id_fkey'
      AND conrelid = 'storage_activity_logs'::regclass
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'storage_activity_logs_from_storage_id_fkey'
      AND conrelid = 'storage_activity_logs'::regclass
  ) THEN
    ALTER TABLE "storage_activity_logs"
      RENAME CONSTRAINT "digital_document_activity_logs_from_storage_id_fkey"
      TO "storage_activity_logs_from_storage_id_fkey";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'digital_document_activity_logs_to_storage_id_fkey'
      AND conrelid = 'storage_activity_logs'::regclass
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'storage_activity_logs_to_storage_id_fkey'
      AND conrelid = 'storage_activity_logs'::regclass
  ) THEN
    ALTER TABLE "storage_activity_logs"
      RENAME CONSTRAINT "digital_document_activity_logs_to_storage_id_fkey"
      TO "storage_activity_logs_to_storage_id_fkey";
  END IF;
END $$;
