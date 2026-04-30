DO $$
BEGIN
  CREATE TYPE "disposition_statuses" AS ENUM ('NEW', 'IN_PROGRESS', 'COMPLETED', 'FORWARDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "incoming_mail_dispositions"
ADD COLUMN IF NOT EXISTS "parent_disposition_id" TEXT;

ALTER TABLE "incoming_mail_dispositions"
ADD COLUMN IF NOT EXISTS "status" "disposition_statuses" NOT NULL DEFAULT 'NEW';

ALTER TABLE "memorandum_dispositions"
ADD COLUMN IF NOT EXISTS "parent_disposition_id" TEXT;

ALTER TABLE "memorandum_dispositions"
ADD COLUMN IF NOT EXISTS "status" "disposition_statuses" NOT NULL DEFAULT 'NEW';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'incoming_mail_dispositions_parent_disposition_id_fkey'
  ) THEN
    ALTER TABLE "incoming_mail_dispositions"
    ADD CONSTRAINT "incoming_mail_dispositions_parent_disposition_id_fkey"
    FOREIGN KEY ("parent_disposition_id")
    REFERENCES "incoming_mail_dispositions"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'memorandum_dispositions_parent_disposition_id_fkey'
  ) THEN
    ALTER TABLE "memorandum_dispositions"
    ADD CONSTRAINT "memorandum_dispositions_parent_disposition_id_fkey"
    FOREIGN KEY ("parent_disposition_id")
    REFERENCES "memorandum_dispositions"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "incoming_mail_dispositions_incoming_mails_id_status_idx"
ON "incoming_mail_dispositions"("incoming_mails_id", "status");

CREATE INDEX IF NOT EXISTS "incoming_mail_dispositions_parent_disposition_id_idx"
ON "incoming_mail_dispositions"("parent_disposition_id");

CREATE INDEX IF NOT EXISTS "memorandum_dispositions_memorandums_id_status_idx"
ON "memorandum_dispositions"("memorandums_id", "status");

CREATE INDEX IF NOT EXISTS "memorandum_dispositions_parent_disposition_id_idx"
ON "memorandum_dispositions"("parent_disposition_id");

UPDATE "incoming_mail_dispositions" AS child
SET "parent_disposition_id" = (
  SELECT parent."id"
  FROM "incoming_mail_dispositions" AS parent
  WHERE parent."incoming_mails_id" = child."incoming_mails_id"
    AND child."sender_id" IS NOT NULL
    AND parent."receiver_id" = child."sender_id"
    AND parent."id" <> child."id"
    AND COALESCE(parent."disposed_at", parent."start_date", TIMESTAMP 'epoch')
      <= COALESCE(child."disposed_at", child."start_date", NOW())
  ORDER BY COALESCE(parent."disposed_at", parent."start_date", TIMESTAMP 'epoch') DESC, parent."id" DESC
  LIMIT 1
)
WHERE child."parent_disposition_id" IS NULL;

UPDATE "memorandum_dispositions" AS child
SET "parent_disposition_id" = (
  SELECT parent."id"
  FROM "memorandum_dispositions" AS parent
  WHERE parent."memorandums_id" = child."memorandums_id"
    AND child."sender_id" IS NOT NULL
    AND parent."receiver_id" = child."sender_id"
    AND parent."id" <> child."id"
    AND COALESCE(parent."disposed_at", parent."start_date", TIMESTAMP 'epoch')
      <= COALESCE(child."disposed_at", child."start_date", NOW())
  ORDER BY COALESCE(parent."disposed_at", parent."start_date", TIMESTAMP 'epoch') DESC, parent."id" DESC
  LIMIT 1
)
WHERE child."parent_disposition_id" IS NULL;

UPDATE "incoming_mail_dispositions" AS disposition
SET "status" = CASE
  WHEN disposition."is_complete" = TRUE THEN 'COMPLETED'::"disposition_statuses"
  WHEN EXISTS (
    SELECT 1
    FROM "incoming_mail_dispositions" AS child
    WHERE child."parent_disposition_id" = disposition."id"
  ) THEN 'FORWARDED'::"disposition_statuses"
  ELSE 'IN_PROGRESS'::"disposition_statuses"
END;

UPDATE "memorandum_dispositions" AS disposition
SET "status" = CASE
  WHEN disposition."is_complete" = TRUE THEN 'COMPLETED'::"disposition_statuses"
  WHEN EXISTS (
    SELECT 1
    FROM "memorandum_dispositions" AS child
    WHERE child."parent_disposition_id" = disposition."id"
  ) THEN 'FORWARDED'::"disposition_statuses"
  ELSE 'IN_PROGRESS'::"disposition_statuses"
END;

UPDATE "incoming_mail_dispositions"
SET "is_complete" = TRUE
WHERE "status" IN ('COMPLETED', 'FORWARDED');

UPDATE "memorandum_dispositions"
SET "is_complete" = TRUE
WHERE "status" IN ('COMPLETED', 'FORWARDED');
