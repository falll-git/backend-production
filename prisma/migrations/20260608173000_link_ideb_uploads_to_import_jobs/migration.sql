ALTER TABLE "debtor_ideb_uploads"
  ADD COLUMN "import_job_id" TEXT;

CREATE INDEX "debtor_ideb_uploads_import_job_id_idx"
  ON "debtor_ideb_uploads"("import_job_id");

ALTER TABLE "debtor_ideb_uploads"
  ADD CONSTRAINT "debtor_ideb_uploads_import_job_id_fkey"
  FOREIGN KEY ("import_job_id")
  REFERENCES "debtor_import_jobs"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
