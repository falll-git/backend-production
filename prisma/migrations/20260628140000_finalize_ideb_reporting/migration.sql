ALTER TABLE "debtor_ideb_uploads"
  ADD COLUMN "source_fingerprint" TEXT;

UPDATE "debtor_ideb_uploads" upload
SET "uploaded_by" = NULL
WHERE "uploaded_by" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "users" app_user
    WHERE app_user."id" = upload."uploaded_by"
  );

WITH duplicate_checksums AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "checksum"
      ORDER BY "created_at", "id"
    ) AS duplicate_order
  FROM "debtor_ideb_upload_files"
  WHERE "checksum" IS NOT NULL
)
UPDATE "debtor_ideb_upload_files" upload_file
SET "checksum" = NULL
FROM duplicate_checksums duplicate
WHERE upload_file."id" = duplicate."id"
  AND duplicate."duplicate_order" > 1;

CREATE UNIQUE INDEX "debtor_ideb_uploads_source_fingerprint_key"
  ON "debtor_ideb_uploads"("source_fingerprint");

CREATE UNIQUE INDEX "debtor_ideb_upload_files_checksum_key"
  ON "debtor_ideb_upload_files"("checksum");

CREATE INDEX "debtor_ideb_uploads_uploaded_by_idx"
  ON "debtor_ideb_uploads"("uploaded_by");

CREATE INDEX "debtor_ideb_uploads_debtor_id_year_month_created_at_idx"
  ON "debtor_ideb_uploads"("debtor_id", "year", "month", "created_at");

ALTER TABLE "debtor_ideb_uploads"
  ADD CONSTRAINT "debtor_ideb_uploads_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

UPDATE "role_menus" ideb_role_menu
SET
  "features" = (
    SELECT ARRAY(
      SELECT DISTINCT feature
      FROM unnest(
        COALESCE(ideb_role_menu."features", ARRAY[]::TEXT[])
        || CASE
          WHEN EXISTS (
            SELECT 1
            FROM "role_menus" source_role_menu
            JOIN "menus" source_menu ON source_menu."id" = source_role_menu."menu_id"
            WHERE source_role_menu."role_id" = ideb_role_menu."role_id"
              AND source_role_menu."can_read" = TRUE
              AND (
                source_role_menu."features" @> ARRAY['report_all']::TEXT[]
                OR source_role_menu."features" @> ARRAY['manage_all']::TEXT[]
              )
              AND source_menu."url" IN (
                '/dashboard/informasi-debitur',
                '/dashboard/informasi-debitur/admin/upload-ideb',
                '/dashboard/informasi-debitur/laporan'
              )
          ) THEN ARRAY['report_all']::TEXT[]
          ELSE ARRAY[]::TEXT[]
        END
        || CASE
          WHEN EXISTS (
            SELECT 1
            FROM "role_menus" source_role_menu
            JOIN "menus" source_menu ON source_menu."id" = source_role_menu."menu_id"
            WHERE source_role_menu."role_id" = ideb_role_menu."role_id"
              AND source_role_menu."can_read" = TRUE
              AND source_role_menu."features" @> ARRAY['view_division']::TEXT[]
              AND source_menu."url" IN (
                '/dashboard/informasi-debitur',
                '/dashboard/informasi-debitur/laporan'
              )
          ) THEN ARRAY['view_division']::TEXT[]
          ELSE ARRAY[]::TEXT[]
        END
      ) AS feature
    )
  ),
  "updated_at" = CURRENT_TIMESTAMP
FROM "menus" ideb_menu
WHERE ideb_role_menu."menu_id" = ideb_menu."id"
  AND ideb_menu."url" = '/dashboard/informasi-debitur/laporan-ideb';
