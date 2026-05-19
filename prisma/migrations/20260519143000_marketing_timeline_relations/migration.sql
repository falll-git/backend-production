CREATE TABLE IF NOT EXISTS "debtor_marketing_timelines" (
  "id" TEXT NOT NULL,
  "group_key" TEXT,
  "debtor_id" TEXT NOT NULL,
  "contract_id" TEXT,
  "title" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debtor_marketing_timelines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "debtor_marketing_timelines_group_key_key"
  ON "debtor_marketing_timelines"("group_key");
CREATE INDEX IF NOT EXISTS "debtor_marketing_timelines_debtor_id_idx"
  ON "debtor_marketing_timelines"("debtor_id");
CREATE INDEX IF NOT EXISTS "debtor_marketing_timelines_contract_id_idx"
  ON "debtor_marketing_timelines"("contract_id");
CREATE INDEX IF NOT EXISTS "debtor_marketing_timelines_status_idx"
  ON "debtor_marketing_timelines"("status");
CREATE INDEX IF NOT EXISTS "debtor_marketing_timelines_started_at_idx"
  ON "debtor_marketing_timelines"("started_at");
CREATE INDEX IF NOT EXISTS "debtor_marketing_timelines_deleted_at_idx"
  ON "debtor_marketing_timelines"("deleted_at");

ALTER TABLE "debtor_marketing_activities"
  ADD COLUMN IF NOT EXISTS "timeline_id" TEXT;

CREATE INDEX IF NOT EXISTS "debtor_marketing_activities_timeline_id_idx"
  ON "debtor_marketing_activities"("timeline_id");

WITH grouped AS (
  SELECT
    COALESCE(NULLIF("timeline_group_id", ''), "id") AS group_key,
    "debtor_id",
    MIN("contract_id") AS contract_id,
    MIN(COALESCE("activity_date", "target_date", "created_at")) AS started_at,
    MAX(
      CASE
        WHEN "activity_kind" = 'HANDLING_STEP' AND "status" IN ('SELESAI', 'DONE', 'COMPLETED') THEN COALESCE("activity_date", "target_date", "updated_at")
        ELSE NULL
      END
    ) AS completed_at,
    MAX("created_by") AS created_by,
    MIN("created_at") AS created_at,
    MAX("updated_at") AS updated_at
  FROM "debtor_marketing_activities"
  WHERE "deleted_at" IS NULL
  GROUP BY COALESCE(NULLIF("timeline_group_id", ''), "id"), "debtor_id"
),
timeline_rows AS (
  SELECT
    CASE
      WHEN group_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN group_key
      ELSE
        substr(md5(group_key), 1, 8) || '-' ||
        substr(md5(group_key), 9, 4) || '-' ||
        substr(md5(group_key), 13, 4) || '-' ||
        substr(md5(group_key), 17, 4) || '-' ||
        substr(md5(group_key), 21, 12)
    END AS id,
    group_key,
    debtor_id,
    contract_id,
    started_at,
    completed_at,
    created_by,
    created_at,
    updated_at
  FROM grouped
)
INSERT INTO "debtor_marketing_timelines" (
  "id",
  "group_key",
  "debtor_id",
  "contract_id",
  "title",
  "status",
  "started_at",
  "completed_at",
  "created_by",
  "created_at",
  "updated_at"
)
SELECT
  id,
  group_key,
  debtor_id,
  contract_id,
  'Timeline Marketing',
  CASE WHEN completed_at IS NULL THEN 'OPEN' ELSE 'CLOSED' END,
  started_at,
  completed_at,
  created_by,
  created_at,
  COALESCE(updated_at, CURRENT_TIMESTAMP)
FROM timeline_rows
ON CONFLICT ("id") DO NOTHING;

WITH activity_keys AS (
  SELECT
    "id" AS activity_id,
    COALESCE(NULLIF("timeline_group_id", ''), "id") AS group_key
  FROM "debtor_marketing_activities"
)
UPDATE "debtor_marketing_activities" activity
SET "timeline_id" = timeline."id"
FROM activity_keys keys
JOIN "debtor_marketing_timelines" timeline
  ON timeline."group_key" = keys.group_key
WHERE activity."id" = keys.activity_id
  AND activity."timeline_id" IS NULL;

UPDATE "debtor_marketing_activities" activity
SET "related_activity_id" = NULL
WHERE activity."related_activity_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "debtor_marketing_activities" related
    WHERE related."id" = activity."related_activity_id"
  );

UPDATE "debtor_documents" document
SET "document_checklist_id" = (
  SELECT checklist."id"
  FROM "document_checklists" checklist
  WHERE checklist."deleted_at" IS NULL
    AND (
      lower(checklist."code") = lower(document."document_type")
      OR lower(checklist."document_type") = lower(document."document_type")
      OR lower(checklist."name") = lower(document."document_type")
    )
  ORDER BY checklist."is_required" DESC, checklist."code" ASC
  LIMIT 1
)
WHERE document."document_checklist_id" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "document_checklists" checklist
    WHERE checklist."deleted_at" IS NULL
      AND (
        lower(checklist."code") = lower(document."document_type")
        OR lower(checklist."document_type") = lower(document."document_type")
        OR lower(checklist."name") = lower(document."document_type")
      )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debtor_marketing_timelines_debtor_id_fkey'
  ) THEN
    ALTER TABLE "debtor_marketing_timelines"
      ADD CONSTRAINT "debtor_marketing_timelines_debtor_id_fkey"
      FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debtor_marketing_timelines_contract_id_fkey'
  ) THEN
    ALTER TABLE "debtor_marketing_timelines"
      ADD CONSTRAINT "debtor_marketing_timelines_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debtor_marketing_activities_timeline_id_fkey'
  ) THEN
    ALTER TABLE "debtor_marketing_activities"
      ADD CONSTRAINT "debtor_marketing_activities_timeline_id_fkey"
      FOREIGN KEY ("timeline_id") REFERENCES "debtor_marketing_timelines"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'debtor_marketing_activities_related_activity_id_fkey'
  ) THEN
    ALTER TABLE "debtor_marketing_activities"
      ADD CONSTRAINT "debtor_marketing_activities_related_activity_id_fkey"
      FOREIGN KEY ("related_activity_id") REFERENCES "debtor_marketing_activities"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
