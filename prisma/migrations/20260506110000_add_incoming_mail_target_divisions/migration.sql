CREATE TABLE IF NOT EXISTS "incoming_mail_target_divisions" (
  "id" TEXT NOT NULL,
  "incoming_mails_id" TEXT NOT NULL,
  "division_id" TEXT NOT NULL,
  "manager_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "incoming_mail_target_divisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incoming_mail_target_divisions_incoming_mails_id_fkey"
    FOREIGN KEY ("incoming_mails_id") REFERENCES "incoming_mails"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "incoming_mail_target_divisions_division_id_fkey"
    FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "incoming_mail_target_divisions_manager_id_fkey"
    FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "incoming_mail_target_divisions_incoming_mails_id_division_id_key"
  ON "incoming_mail_target_divisions"("incoming_mails_id", "division_id");

CREATE INDEX IF NOT EXISTS "incoming_mail_target_divisions_division_id_idx"
  ON "incoming_mail_target_divisions"("division_id");

CREATE INDEX IF NOT EXISTS "incoming_mail_target_divisions_manager_id_idx"
  ON "incoming_mail_target_divisions"("manager_id");

INSERT INTO "incoming_mail_target_divisions" (
  "id",
  "incoming_mails_id",
  "division_id",
  "manager_id",
  "created_at",
  "updated_at"
)
SELECT
  md5("id" || "division_id" || clock_timestamp()::TEXT),
  "id",
  "division_id",
  NULL,
  "created_at",
  "updated_at"
FROM "incoming_mails"
WHERE "division_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "incoming_mail_target_divisions" AS target
    WHERE target."incoming_mails_id" = "incoming_mails"."id"
      AND target."division_id" = "incoming_mails"."division_id"
  );
