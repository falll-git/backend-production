ALTER TABLE "digital_debtors"
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "branch_id" TEXT,
  ADD COLUMN IF NOT EXISTS "marketing_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "created_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_by" TEXT,
  ADD COLUMN IF NOT EXISTS "deleted_by" TEXT,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

CREATE TABLE "branches" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "phone" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "financing_products" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "financing_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collectibility_levels" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "is_npf" BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "collectibility_levels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_types" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contract_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "third_parties" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "address" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "contact_person" TEXT,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "third_parties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_checklists" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "document_type" TEXT,
  "description" TEXT,
  "is_required" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "document_checklists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "numbering_templates" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "document_type" TEXT NOT NULL,
  "prefix_template" TEXT NOT NULL,
  "sequence_padding" INTEGER NOT NULL DEFAULT 4,
  "reset_period" TEXT NOT NULL DEFAULT 'MONTHLY',
  "last_sequence" INTEGER NOT NULL DEFAULT 0,
  "last_period_key" TEXT,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "numbering_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "institution_profiles" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legal_name" TEXT,
  "address" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "tax_number" TEXT,
  "license_number" TEXT,
  "logo_file_path" TEXT,
  "logo_file_name" TEXT,
  "logo_mime_type" TEXT,
  "logo_size_bytes" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "institution_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sla_reminder_configs" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "event_key" TEXT NOT NULL,
  "due_days" INTEGER NOT NULL,
  "reminder_days_before" INTEGER NOT NULL DEFAULT 0,
  "escalation_days" INTEGER,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sla_reminder_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "marketing_activity_types" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketing_activity_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deposit_types" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "deposit_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debtor_contracts" (
  "id" TEXT NOT NULL,
  "no_kontrak" TEXT NOT NULL,
  "debtor_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "akad_type_id" TEXT NOT NULL,
  "branch_id" TEXT,
  "marketing_user_id" TEXT,
  "tanggal_akad" TIMESTAMP(3) NOT NULL,
  "tanggal_jatuh_tempo" TIMESTAMP(3),
  "plafond" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "pokok" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "margin" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "tenor" INTEGER NOT NULL,
  "outstanding_pokok" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "outstanding_margin" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "objek_pembiayaan" TEXT,
  "agunan" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "debtor_contracts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debtor_collectibilities" (
  "id" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "period_month" TEXT NOT NULL,
  "kol_level_id" TEXT NOT NULL,
  "outstanding_pokok" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "outstanding_margin" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "dpd" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "debtor_collectibilities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debtor_import_jobs" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "success_rows" INTEGER NOT NULL DEFAULT 0,
  "failed_rows" INTEGER NOT NULL DEFAULT 0,
  "error_summary" JSONB,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "debtor_import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debtor_external_records" (
  "id" TEXT NOT NULL,
  "import_job_id" TEXT,
  "source_type" TEXT NOT NULL,
  "debtor_id" TEXT,
  "contract_id" TEXT,
  "period_month" TEXT,
  "status" TEXT NOT NULL DEFAULT 'MATCH_PENDING',
  "raw_reference" TEXT,
  "summary" JSONB,
  "file_path" TEXT,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "debtor_external_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debtor_documents" (
  "id" TEXT NOT NULL,
  "debtor_id" TEXT NOT NULL,
  "contract_id" TEXT,
  "document_checklist_id" TEXT,
  "document_type" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'LAINNYA',
  "description" TEXT,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "uploaded_by" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "debtor_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debtor_marketing_activities" (
  "id" TEXT NOT NULL,
  "activity_kind" TEXT NOT NULL,
  "debtor_id" TEXT NOT NULL,
  "contract_id" TEXT,
  "marketing_activity_type_id" TEXT,
  "activity_date" TIMESTAMP(3),
  "target_date" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "action_plan" TEXT,
  "visit_address" TEXT,
  "visit_result" TEXT,
  "conclusion" TEXT,
  "handling_step" TEXT,
  "handling_result" TEXT,
  "notes" TEXT,
  "file_path" TEXT,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "debtor_marketing_activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debtor_warning_letters" (
  "id" TEXT NOT NULL,
  "debtor_id" TEXT NOT NULL,
  "contract_id" TEXT,
  "letter_type" TEXT NOT NULL,
  "issued_at" TIMESTAMP(3) NOT NULL,
  "sent_at" TIMESTAMP(3),
  "delivery_status" TEXT NOT NULL DEFAULT 'BELUM_DIKIRIM',
  "description" TEXT,
  "file_path" TEXT,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "debtor_warning_letters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_document_templates" (
  "id" TEXT NOT NULL,
  "template_type" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "title" TEXT NOT NULL,
  "content_template" TEXT,
  "file_path" TEXT,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "legal_document_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_print_histories" (
  "id" TEXT NOT NULL,
  "template_id" TEXT,
  "numbering_template_id" TEXT,
  "contract_id" TEXT NOT NULL,
  "document_type" TEXT NOT NULL,
  "generated_number" TEXT NOT NULL,
  "payload_snapshot" JSONB,
  "generated_file_path" TEXT,
  "generated_file_name" TEXT,
  "generated_mime_type" TEXT,
  "generated_size_bytes" INTEGER,
  "printed_by" TEXT,
  "printed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "legal_print_histories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_ideb_uploads" (
  "id" TEXT NOT NULL,
  "debtor_id" TEXT,
  "contract_id" TEXT,
  "month" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "result_summary" JSONB,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "uploaded_by" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "legal_ideb_uploads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_notary_progress" (
  "id" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "third_party_id" TEXT NOT NULL,
  "deed_type" TEXT NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL,
  "estimated_completed_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PROSES',
  "deed_number" TEXT,
  "notes" TEXT,
  "file_path" TEXT,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "legal_notary_progress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_insurance_progress" (
  "id" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "third_party_id" TEXT NOT NULL,
  "insurance_type" TEXT NOT NULL,
  "coverage_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3),
  "policy_number" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PROSES',
  "notes" TEXT,
  "file_path" TEXT,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "legal_insurance_progress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_claims" (
  "id" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "insurance_progress_id" TEXT,
  "policy_number" TEXT,
  "claim_type" TEXT NOT NULL,
  "claim_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "submitted_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENGAJUAN',
  "approved_amount" DECIMAL(18,2),
  "disbursed_amount" DECIMAL(18,2),
  "disbursed_at" TIMESTAMP(3),
  "rejection_reason" TEXT,
  "notes" TEXT,
  "file_path" TEXT,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "legal_claims_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_deposits" (
  "id" TEXT NOT NULL,
  "deposit_type_id" TEXT,
  "type" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "third_party_id" TEXT,
  "nominal" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "processed_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "remaining_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "deleted_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "legal_deposits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_deposit_transactions" (
  "id" TEXT NOT NULL,
  "deposit_id" TEXT NOT NULL,
  "transaction_date" TIMESTAMP(3) NOT NULL,
  "action" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_deposit_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");
CREATE UNIQUE INDEX "financing_products_code_key" ON "financing_products"("code");
CREATE UNIQUE INDEX "financing_products_name_key" ON "financing_products"("name");
CREATE UNIQUE INDEX "collectibility_levels_code_key" ON "collectibility_levels"("code");
CREATE UNIQUE INDEX "collectibility_levels_level_key" ON "collectibility_levels"("level");
CREATE UNIQUE INDEX "collectibility_levels_name_key" ON "collectibility_levels"("name");
CREATE UNIQUE INDEX "contract_types_code_key" ON "contract_types"("code");
CREATE UNIQUE INDEX "contract_types_name_key" ON "contract_types"("name");
CREATE UNIQUE INDEX "third_parties_code_key" ON "third_parties"("code");
CREATE UNIQUE INDEX "third_parties_category_name_key" ON "third_parties"("category", "name");
CREATE UNIQUE INDEX "document_checklists_code_key" ON "document_checklists"("code");
CREATE UNIQUE INDEX "numbering_templates_code_key" ON "numbering_templates"("code");
CREATE UNIQUE INDEX "institution_profiles_code_key" ON "institution_profiles"("code");
CREATE UNIQUE INDEX "sla_reminder_configs_code_key" ON "sla_reminder_configs"("code");
CREATE UNIQUE INDEX "marketing_activity_types_code_key" ON "marketing_activity_types"("code");
CREATE UNIQUE INDEX "deposit_types_code_key" ON "deposit_types"("code");
CREATE UNIQUE INDEX "debtor_contracts_no_kontrak_key" ON "debtor_contracts"("no_kontrak");
CREATE UNIQUE INDEX "debtor_collectibilities_contract_id_period_month_key" ON "debtor_collectibilities"("contract_id", "period_month");
CREATE UNIQUE INDEX "legal_document_templates_template_type_version_key" ON "legal_document_templates"("template_type", "version");
CREATE UNIQUE INDEX "legal_print_histories_generated_number_key" ON "legal_print_histories"("generated_number");

CREATE UNIQUE INDEX "numbering_templates_active_unique"
  ON "numbering_templates"("module", "document_type")
  WHERE "is_active" = true AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "institution_profiles_active_unique"
  ON "institution_profiles"("is_active")
  WHERE "is_active" = true AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "legal_document_templates_active_unique"
  ON "legal_document_templates"("template_type")
  WHERE "is_active" = true AND "deleted_at" IS NULL;

CREATE INDEX "branches_name_idx" ON "branches"("name");
CREATE INDEX "branches_is_active_idx" ON "branches"("is_active");
CREATE INDEX "branches_deleted_at_idx" ON "branches"("deleted_at");
CREATE INDEX "financing_products_is_active_idx" ON "financing_products"("is_active");
CREATE INDEX "financing_products_deleted_at_idx" ON "financing_products"("deleted_at");
CREATE INDEX "collectibility_levels_is_npf_idx" ON "collectibility_levels"("is_npf");
CREATE INDEX "collectibility_levels_is_active_idx" ON "collectibility_levels"("is_active");
CREATE INDEX "collectibility_levels_deleted_at_idx" ON "collectibility_levels"("deleted_at");
CREATE INDEX "contract_types_is_active_idx" ON "contract_types"("is_active");
CREATE INDEX "contract_types_deleted_at_idx" ON "contract_types"("deleted_at");
CREATE INDEX "third_parties_category_idx" ON "third_parties"("category");
CREATE INDEX "third_parties_is_active_idx" ON "third_parties"("is_active");
CREATE INDEX "third_parties_deleted_at_idx" ON "third_parties"("deleted_at");
CREATE INDEX "document_checklists_category_idx" ON "document_checklists"("category");
CREATE INDEX "document_checklists_is_active_idx" ON "document_checklists"("is_active");
CREATE INDEX "document_checklists_deleted_at_idx" ON "document_checklists"("deleted_at");
CREATE INDEX "numbering_templates_module_document_type_idx" ON "numbering_templates"("module", "document_type");
CREATE INDEX "numbering_templates_is_active_idx" ON "numbering_templates"("is_active");
CREATE INDEX "numbering_templates_deleted_at_idx" ON "numbering_templates"("deleted_at");
CREATE INDEX "institution_profiles_is_active_idx" ON "institution_profiles"("is_active");
CREATE INDEX "institution_profiles_deleted_at_idx" ON "institution_profiles"("deleted_at");
CREATE INDEX "sla_reminder_configs_module_event_key_idx" ON "sla_reminder_configs"("module", "event_key");
CREATE INDEX "sla_reminder_configs_is_active_idx" ON "sla_reminder_configs"("is_active");
CREATE INDEX "sla_reminder_configs_deleted_at_idx" ON "sla_reminder_configs"("deleted_at");
CREATE INDEX "marketing_activity_types_category_idx" ON "marketing_activity_types"("category");
CREATE INDEX "marketing_activity_types_is_active_idx" ON "marketing_activity_types"("is_active");
CREATE INDEX "marketing_activity_types_deleted_at_idx" ON "marketing_activity_types"("deleted_at");
CREATE INDEX "deposit_types_category_idx" ON "deposit_types"("category");
CREATE INDEX "deposit_types_is_active_idx" ON "deposit_types"("is_active");
CREATE INDEX "deposit_types_deleted_at_idx" ON "deposit_types"("deleted_at");

CREATE INDEX "digital_debtors_branch_id_idx" ON "digital_debtors"("branch_id");
CREATE INDEX "digital_debtors_marketing_user_id_idx" ON "digital_debtors"("marketing_user_id");
CREATE INDEX "digital_debtors_status_idx" ON "digital_debtors"("status");
CREATE INDEX "digital_debtors_deleted_at_idx" ON "digital_debtors"("deleted_at");

CREATE INDEX "debtor_contracts_debtor_id_idx" ON "debtor_contracts"("debtor_id");
CREATE INDEX "debtor_contracts_product_id_idx" ON "debtor_contracts"("product_id");
CREATE INDEX "debtor_contracts_akad_type_id_idx" ON "debtor_contracts"("akad_type_id");
CREATE INDEX "debtor_contracts_branch_id_idx" ON "debtor_contracts"("branch_id");
CREATE INDEX "debtor_contracts_marketing_user_id_idx" ON "debtor_contracts"("marketing_user_id");
CREATE INDEX "debtor_contracts_status_idx" ON "debtor_contracts"("status");
CREATE INDEX "debtor_contracts_deleted_at_idx" ON "debtor_contracts"("deleted_at");
CREATE INDEX "debtor_collectibilities_kol_level_id_idx" ON "debtor_collectibilities"("kol_level_id");
CREATE INDEX "debtor_collectibilities_period_month_idx" ON "debtor_collectibilities"("period_month");
CREATE INDEX "debtor_collectibilities_deleted_at_idx" ON "debtor_collectibilities"("deleted_at");
CREATE INDEX "debtor_import_jobs_type_status_idx" ON "debtor_import_jobs"("type", "status");
CREATE INDEX "debtor_import_jobs_created_at_idx" ON "debtor_import_jobs"("created_at");
CREATE INDEX "debtor_import_jobs_deleted_at_idx" ON "debtor_import_jobs"("deleted_at");
CREATE INDEX "debtor_external_records_source_type_status_idx" ON "debtor_external_records"("source_type", "status");
CREATE INDEX "debtor_external_records_debtor_id_idx" ON "debtor_external_records"("debtor_id");
CREATE INDEX "debtor_external_records_contract_id_idx" ON "debtor_external_records"("contract_id");
CREATE INDEX "debtor_external_records_period_month_idx" ON "debtor_external_records"("period_month");
CREATE INDEX "debtor_external_records_deleted_at_idx" ON "debtor_external_records"("deleted_at");
CREATE INDEX "debtor_documents_debtor_id_idx" ON "debtor_documents"("debtor_id");
CREATE INDEX "debtor_documents_contract_id_idx" ON "debtor_documents"("contract_id");
CREATE INDEX "debtor_documents_document_checklist_id_idx" ON "debtor_documents"("document_checklist_id");
CREATE INDEX "debtor_documents_document_type_idx" ON "debtor_documents"("document_type");
CREATE INDEX "debtor_documents_category_idx" ON "debtor_documents"("category");
CREATE INDEX "debtor_documents_deleted_at_idx" ON "debtor_documents"("deleted_at");
CREATE INDEX "debtor_marketing_activities_activity_kind_status_idx" ON "debtor_marketing_activities"("activity_kind", "status");
CREATE INDEX "debtor_marketing_activities_debtor_id_idx" ON "debtor_marketing_activities"("debtor_id");
CREATE INDEX "debtor_marketing_activities_contract_id_idx" ON "debtor_marketing_activities"("contract_id");
CREATE INDEX "debtor_marketing_activities_marketing_activity_type_id_idx" ON "debtor_marketing_activities"("marketing_activity_type_id");
CREATE INDEX "debtor_marketing_activities_activity_date_idx" ON "debtor_marketing_activities"("activity_date");
CREATE INDEX "debtor_marketing_activities_deleted_at_idx" ON "debtor_marketing_activities"("deleted_at");
CREATE INDEX "debtor_warning_letters_debtor_id_idx" ON "debtor_warning_letters"("debtor_id");
CREATE INDEX "debtor_warning_letters_contract_id_idx" ON "debtor_warning_letters"("contract_id");
CREATE INDEX "debtor_warning_letters_letter_type_idx" ON "debtor_warning_letters"("letter_type");
CREATE INDEX "debtor_warning_letters_delivery_status_idx" ON "debtor_warning_letters"("delivery_status");
CREATE INDEX "debtor_warning_letters_deleted_at_idx" ON "debtor_warning_letters"("deleted_at");

CREATE INDEX "legal_document_templates_template_type_idx" ON "legal_document_templates"("template_type");
CREATE INDEX "legal_document_templates_is_active_idx" ON "legal_document_templates"("is_active");
CREATE INDEX "legal_document_templates_deleted_at_idx" ON "legal_document_templates"("deleted_at");
CREATE INDEX "legal_print_histories_contract_id_idx" ON "legal_print_histories"("contract_id");
CREATE INDEX "legal_print_histories_document_type_idx" ON "legal_print_histories"("document_type");
CREATE INDEX "legal_print_histories_printed_at_idx" ON "legal_print_histories"("printed_at");
CREATE INDEX "legal_print_histories_deleted_at_idx" ON "legal_print_histories"("deleted_at");
CREATE INDEX "legal_ideb_uploads_debtor_id_idx" ON "legal_ideb_uploads"("debtor_id");
CREATE INDEX "legal_ideb_uploads_contract_id_idx" ON "legal_ideb_uploads"("contract_id");
CREATE INDEX "legal_ideb_uploads_year_month_idx" ON "legal_ideb_uploads"("year", "month");
CREATE INDEX "legal_ideb_uploads_status_idx" ON "legal_ideb_uploads"("status");
CREATE INDEX "legal_ideb_uploads_deleted_at_idx" ON "legal_ideb_uploads"("deleted_at");
CREATE INDEX "legal_notary_progress_contract_id_idx" ON "legal_notary_progress"("contract_id");
CREATE INDEX "legal_notary_progress_third_party_id_idx" ON "legal_notary_progress"("third_party_id");
CREATE INDEX "legal_notary_progress_status_idx" ON "legal_notary_progress"("status");
CREATE INDEX "legal_notary_progress_deleted_at_idx" ON "legal_notary_progress"("deleted_at");
CREATE INDEX "legal_insurance_progress_contract_id_idx" ON "legal_insurance_progress"("contract_id");
CREATE INDEX "legal_insurance_progress_third_party_id_idx" ON "legal_insurance_progress"("third_party_id");
CREATE INDEX "legal_insurance_progress_policy_number_idx" ON "legal_insurance_progress"("policy_number");
CREATE INDEX "legal_insurance_progress_status_idx" ON "legal_insurance_progress"("status");
CREATE INDEX "legal_insurance_progress_deleted_at_idx" ON "legal_insurance_progress"("deleted_at");
CREATE INDEX "legal_claims_contract_id_idx" ON "legal_claims"("contract_id");
CREATE INDEX "legal_claims_insurance_progress_id_idx" ON "legal_claims"("insurance_progress_id");
CREATE INDEX "legal_claims_policy_number_idx" ON "legal_claims"("policy_number");
CREATE INDEX "legal_claims_status_idx" ON "legal_claims"("status");
CREATE INDEX "legal_claims_deleted_at_idx" ON "legal_claims"("deleted_at");
CREATE INDEX "legal_deposits_deposit_type_id_idx" ON "legal_deposits"("deposit_type_id");
CREATE INDEX "legal_deposits_type_idx" ON "legal_deposits"("type");
CREATE INDEX "legal_deposits_contract_id_idx" ON "legal_deposits"("contract_id");
CREATE INDEX "legal_deposits_third_party_id_idx" ON "legal_deposits"("third_party_id");
CREATE INDEX "legal_deposits_status_idx" ON "legal_deposits"("status");
CREATE INDEX "legal_deposits_deleted_at_idx" ON "legal_deposits"("deleted_at");
CREATE INDEX "legal_deposit_transactions_deposit_id_idx" ON "legal_deposit_transactions"("deposit_id");
CREATE INDEX "legal_deposit_transactions_transaction_date_idx" ON "legal_deposit_transactions"("transaction_date");
CREATE INDEX "legal_deposit_transactions_action_idx" ON "legal_deposit_transactions"("action");

ALTER TABLE "digital_debtors" ADD CONSTRAINT "digital_debtors_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "digital_debtors" ADD CONSTRAINT "digital_debtors_marketing_user_id_fkey" FOREIGN KEY ("marketing_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debtor_contracts" ADD CONSTRAINT "debtor_contracts_debtor_id_fkey" FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "debtor_contracts" ADD CONSTRAINT "debtor_contracts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "financing_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "debtor_contracts" ADD CONSTRAINT "debtor_contracts_akad_type_id_fkey" FOREIGN KEY ("akad_type_id") REFERENCES "contract_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "debtor_contracts" ADD CONSTRAINT "debtor_contracts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debtor_contracts" ADD CONSTRAINT "debtor_contracts_marketing_user_id_fkey" FOREIGN KEY ("marketing_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debtor_collectibilities" ADD CONSTRAINT "debtor_collectibilities_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "debtor_collectibilities" ADD CONSTRAINT "debtor_collectibilities_kol_level_id_fkey" FOREIGN KEY ("kol_level_id") REFERENCES "collectibility_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "debtor_external_records" ADD CONSTRAINT "debtor_external_records_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "debtor_import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debtor_external_records" ADD CONSTRAINT "debtor_external_records_debtor_id_fkey" FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debtor_external_records" ADD CONSTRAINT "debtor_external_records_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debtor_documents" ADD CONSTRAINT "debtor_documents_debtor_id_fkey" FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "debtor_documents" ADD CONSTRAINT "debtor_documents_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debtor_documents" ADD CONSTRAINT "debtor_documents_document_checklist_id_fkey" FOREIGN KEY ("document_checklist_id") REFERENCES "document_checklists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debtor_marketing_activities" ADD CONSTRAINT "debtor_marketing_activities_debtor_id_fkey" FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "debtor_marketing_activities" ADD CONSTRAINT "debtor_marketing_activities_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debtor_marketing_activities" ADD CONSTRAINT "debtor_marketing_activities_marketing_activity_type_id_fkey" FOREIGN KEY ("marketing_activity_type_id") REFERENCES "marketing_activity_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debtor_warning_letters" ADD CONSTRAINT "debtor_warning_letters_debtor_id_fkey" FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "debtor_warning_letters" ADD CONSTRAINT "debtor_warning_letters_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legal_print_histories" ADD CONSTRAINT "legal_print_histories_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "legal_document_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "legal_print_histories" ADD CONSTRAINT "legal_print_histories_numbering_template_id_fkey" FOREIGN KEY ("numbering_template_id") REFERENCES "numbering_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "legal_print_histories" ADD CONSTRAINT "legal_print_histories_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_ideb_uploads" ADD CONSTRAINT "legal_ideb_uploads_debtor_id_fkey" FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "legal_ideb_uploads" ADD CONSTRAINT "legal_ideb_uploads_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "legal_notary_progress" ADD CONSTRAINT "legal_notary_progress_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_notary_progress" ADD CONSTRAINT "legal_notary_progress_third_party_id_fkey" FOREIGN KEY ("third_party_id") REFERENCES "third_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_insurance_progress" ADD CONSTRAINT "legal_insurance_progress_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_insurance_progress" ADD CONSTRAINT "legal_insurance_progress_third_party_id_fkey" FOREIGN KEY ("third_party_id") REFERENCES "third_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_claims" ADD CONSTRAINT "legal_claims_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_claims" ADD CONSTRAINT "legal_claims_insurance_progress_id_fkey" FOREIGN KEY ("insurance_progress_id") REFERENCES "legal_insurance_progress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "legal_deposits" ADD CONSTRAINT "legal_deposits_deposit_type_id_fkey" FOREIGN KEY ("deposit_type_id") REFERENCES "deposit_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "legal_deposits" ADD CONSTRAINT "legal_deposits_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_deposits" ADD CONSTRAINT "legal_deposits_third_party_id_fkey" FOREIGN KEY ("third_party_id") REFERENCES "third_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "legal_deposit_transactions" ADD CONSTRAINT "legal_deposit_transactions_deposit_id_fkey" FOREIGN KEY ("deposit_id") REFERENCES "legal_deposits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
