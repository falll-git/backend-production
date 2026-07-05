CREATE TABLE "debtor_activity_logs" (
  "id" TEXT NOT NULL,
  "actor_id" TEXT,
  "action" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "debtor_id" TEXT,
  "contract_id" TEXT,
  "import_job_id" TEXT,
  "ideb_upload_id" TEXT,
  "document_id" TEXT,
  "marketing_activity_id" TEXT,
  "warning_letter_id" TEXT,
  "title" TEXT,
  "before_data" JSONB,
  "after_data" JSONB,
  "metadata" JSONB,
  "request_ip" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "debtor_activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "debtor_activity_logs_actor_id_created_at_idx" ON "debtor_activity_logs"("actor_id", "created_at");
CREATE INDEX "debtor_activity_logs_action_created_at_idx" ON "debtor_activity_logs"("action", "created_at");
CREATE INDEX "debtor_activity_logs_source_created_at_idx" ON "debtor_activity_logs"("source", "created_at");
CREATE INDEX "debtor_activity_logs_entity_type_entity_id_idx" ON "debtor_activity_logs"("entity_type", "entity_id");
CREATE INDEX "debtor_activity_logs_debtor_id_created_at_idx" ON "debtor_activity_logs"("debtor_id", "created_at");
CREATE INDEX "debtor_activity_logs_contract_id_created_at_idx" ON "debtor_activity_logs"("contract_id", "created_at");
CREATE INDEX "debtor_activity_logs_import_job_id_created_at_idx" ON "debtor_activity_logs"("import_job_id", "created_at");
CREATE INDEX "debtor_activity_logs_ideb_upload_id_created_at_idx" ON "debtor_activity_logs"("ideb_upload_id", "created_at");
CREATE INDEX "debtor_activity_logs_document_id_created_at_idx" ON "debtor_activity_logs"("document_id", "created_at");
CREATE INDEX "debtor_activity_logs_marketing_activity_id_created_at_idx" ON "debtor_activity_logs"("marketing_activity_id", "created_at");
CREATE INDEX "debtor_activity_logs_warning_letter_id_created_at_idx" ON "debtor_activity_logs"("warning_letter_id", "created_at");

ALTER TABLE "debtor_activity_logs"
  ADD CONSTRAINT "debtor_activity_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debtor_activity_logs"
  ADD CONSTRAINT "debtor_activity_logs_debtor_id_fkey"
  FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debtor_activity_logs"
  ADD CONSTRAINT "debtor_activity_logs_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debtor_activity_logs"
  ADD CONSTRAINT "debtor_activity_logs_import_job_id_fkey"
  FOREIGN KEY ("import_job_id") REFERENCES "debtor_import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debtor_activity_logs"
  ADD CONSTRAINT "debtor_activity_logs_ideb_upload_id_fkey"
  FOREIGN KEY ("ideb_upload_id") REFERENCES "debtor_ideb_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debtor_activity_logs"
  ADD CONSTRAINT "debtor_activity_logs_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "debtor_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debtor_activity_logs"
  ADD CONSTRAINT "debtor_activity_logs_marketing_activity_id_fkey"
  FOREIGN KEY ("marketing_activity_id") REFERENCES "debtor_marketing_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debtor_activity_logs"
  ADD CONSTRAINT "debtor_activity_logs_warning_letter_id_fkey"
  FOREIGN KEY ("warning_letter_id") REFERENCES "debtor_warning_letters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
