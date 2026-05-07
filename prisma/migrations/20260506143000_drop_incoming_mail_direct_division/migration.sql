DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'incoming_mails'
      AND column_name = 'division_id'
  ) THEN
    EXECUTE '
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
        NOW(),
        NOW()
      FROM "incoming_mails"
      WHERE "division_id" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "incoming_mail_target_divisions" AS target
          WHERE target."incoming_mails_id" = "incoming_mails"."id"
            AND target."division_id" = "incoming_mails"."division_id"
        )
    ';
  END IF;
END $$;

ALTER TABLE "incoming_mails"
DROP CONSTRAINT IF EXISTS "incoming_mails_division_id_fkey";

DROP INDEX IF EXISTS "incoming_mails_division_id_idx";

ALTER TABLE "incoming_mails"
DROP COLUMN IF EXISTS "division_id";
