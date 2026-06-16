CREATE TABLE "debtor_ideb_upload_files" (
  "id" TEXT NOT NULL,
  "upload_id" TEXT NOT NULL,
  "part_number" INTEGER NOT NULL DEFAULT 1,
  "total_parts" INTEGER NOT NULL DEFAULT 1,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "debtor_ideb_upload_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "debtor_ideb_upload_files_upload_id_part_number_key"
  ON "debtor_ideb_upload_files"("upload_id", "part_number");

CREATE INDEX "debtor_ideb_upload_files_upload_id_idx"
  ON "debtor_ideb_upload_files"("upload_id");

CREATE INDEX "debtor_ideb_upload_files_part_number_idx"
  ON "debtor_ideb_upload_files"("part_number");

ALTER TABLE "debtor_ideb_upload_files"
  ADD CONSTRAINT "debtor_ideb_upload_files_upload_id_fkey"
  FOREIGN KEY ("upload_id") REFERENCES "debtor_ideb_uploads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "debtor_ideb_upload_files" (
  "id",
  "upload_id",
  "part_number",
  "total_parts",
  "file_path",
  "file_name",
  "mime_type",
  "size_bytes",
  "checksum",
  "created_at",
  "updated_at"
)
SELECT
  md5("id" || ':ideb-part:1'),
  "id",
  1,
  1,
  "file_path",
  "file_name",
  "mime_type",
  "size_bytes",
  "checksum",
  COALESCE("created_at", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM "debtor_ideb_uploads"
WHERE "deleted_at" IS NULL
  AND "file_path" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "debtor_ideb_upload_files" f
    WHERE f."upload_id" = "debtor_ideb_uploads"."id"
  );
