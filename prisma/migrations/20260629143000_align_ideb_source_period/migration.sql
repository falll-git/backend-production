WITH source_periods AS (
  SELECT
    "id",
    "import_job_id",
    "result_summary" ->> 'period_month' AS "period_month"
  FROM "debtor_ideb_uploads"
  WHERE
    "deleted_at" IS NULL
    AND ("result_summary" ->> 'period_month') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
)
UPDATE "debtor_ideb_uploads" AS upload
SET
  "year" = substring(source."period_month" FROM 1 FOR 4)::INTEGER,
  "month" = substring(source."period_month" FROM 6 FOR 2)::INTEGER,
  "updated_at" = NOW()
FROM source_periods AS source
WHERE
  upload."id" = source."id"
  AND (
    upload."year" <> substring(source."period_month" FROM 1 FOR 4)::INTEGER
    OR upload."month" <> substring(source."period_month" FROM 6 FOR 2)::INTEGER
  );

WITH source_periods AS (
  SELECT
    "import_job_id",
    "result_summary" ->> 'period_month' AS "period_month"
  FROM "debtor_ideb_uploads"
  WHERE
    "deleted_at" IS NULL
    AND "import_job_id" IS NOT NULL
    AND ("result_summary" ->> 'period_month') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
)
UPDATE "debtor_import_jobs" AS job
SET
  "period_month" = source."period_month",
  "updated_at" = NOW()
FROM source_periods AS source
WHERE
  job."id" = source."import_job_id"
  AND job."type" = 'IDEB'
  AND job."period_month" IS DISTINCT FROM source."period_month";

WITH source_periods AS (
  SELECT
    upload."import_job_id",
    upload."file_path",
    upload."result_summary" ->> 'period_month' AS "period_month"
  FROM "debtor_ideb_uploads" AS upload
  WHERE
    upload."deleted_at" IS NULL
    AND (upload."result_summary" ->> 'period_month') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
)
UPDATE "debtor_external_records" AS record
SET
  "period_month" = source."period_month",
  "updated_at" = NOW()
FROM source_periods AS source
WHERE
  record."source_type" = 'IDEB'
  AND record."deleted_at" IS NULL
  AND (
    (source."import_job_id" IS NOT NULL AND record."import_job_id" = source."import_job_id")
    OR (source."file_path" IS NOT NULL AND record."file_path" = source."file_path")
  )
  AND record."period_month" IS DISTINCT FROM source."period_month";
