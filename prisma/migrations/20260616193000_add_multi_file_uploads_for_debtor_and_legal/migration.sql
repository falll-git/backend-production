CREATE TABLE "debtor_document_files" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debtor_document_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debtor_marketing_activity_files" (
  "id" TEXT NOT NULL,
  "activity_id" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debtor_marketing_activity_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debtor_warning_letter_files" (
  "id" TEXT NOT NULL,
  "letter_id" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debtor_warning_letter_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_document_template_files" (
  "id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_document_template_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_print_history_files" (
  "id" TEXT NOT NULL,
  "print_id" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_print_history_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_notary_progress_files" (
  "id" TEXT NOT NULL,
  "progress_id" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_notary_progress_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_insurance_progress_files" (
  "id" TEXT NOT NULL,
  "progress_id" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_insurance_progress_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_kjpp_progress_files" (
  "id" TEXT NOT NULL,
  "progress_id" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_kjpp_progress_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_claim_files" (
  "id" TEXT NOT NULL,
  "claim_id" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_claim_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_deposit_transaction_files" (
  "id" TEXT NOT NULL,
  "transaction_id" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "size_bytes" INTEGER,
  "checksum" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_deposit_transaction_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "debtor_document_files_document_id_file_path_key" ON "debtor_document_files"("document_id", "file_path");
CREATE UNIQUE INDEX "debtor_marketing_activity_files_activity_id_file_path_key" ON "debtor_marketing_activity_files"("activity_id", "file_path");
CREATE UNIQUE INDEX "debtor_warning_letter_files_letter_id_file_path_key" ON "debtor_warning_letter_files"("letter_id", "file_path");
CREATE UNIQUE INDEX "legal_document_template_files_template_id_file_path_key" ON "legal_document_template_files"("template_id", "file_path");
CREATE UNIQUE INDEX "legal_print_history_files_print_id_file_path_key" ON "legal_print_history_files"("print_id", "file_path");
CREATE UNIQUE INDEX "legal_notary_progress_files_progress_id_file_path_key" ON "legal_notary_progress_files"("progress_id", "file_path");
CREATE UNIQUE INDEX "legal_insurance_progress_files_progress_id_file_path_key" ON "legal_insurance_progress_files"("progress_id", "file_path");
CREATE UNIQUE INDEX "legal_kjpp_progress_files_progress_id_file_path_key" ON "legal_kjpp_progress_files"("progress_id", "file_path");
CREATE UNIQUE INDEX "legal_claim_files_claim_id_file_path_key" ON "legal_claim_files"("claim_id", "file_path");
CREATE UNIQUE INDEX "legal_deposit_transaction_files_transaction_id_file_path_key" ON "legal_deposit_transaction_files"("transaction_id", "file_path");

CREATE INDEX "debtor_document_files_document_id_idx" ON "debtor_document_files"("document_id");
CREATE INDEX "debtor_marketing_activity_files_activity_id_idx" ON "debtor_marketing_activity_files"("activity_id");
CREATE INDEX "debtor_warning_letter_files_letter_id_idx" ON "debtor_warning_letter_files"("letter_id");
CREATE INDEX "legal_document_template_files_template_id_idx" ON "legal_document_template_files"("template_id");
CREATE INDEX "legal_print_history_files_print_id_idx" ON "legal_print_history_files"("print_id");
CREATE INDEX "legal_notary_progress_files_progress_id_idx" ON "legal_notary_progress_files"("progress_id");
CREATE INDEX "legal_insurance_progress_files_progress_id_idx" ON "legal_insurance_progress_files"("progress_id");
CREATE INDEX "legal_kjpp_progress_files_progress_id_idx" ON "legal_kjpp_progress_files"("progress_id");
CREATE INDEX "legal_claim_files_claim_id_idx" ON "legal_claim_files"("claim_id");
CREATE INDEX "legal_deposit_transaction_files_transaction_id_idx" ON "legal_deposit_transaction_files"("transaction_id");

ALTER TABLE "debtor_document_files"
  ADD CONSTRAINT "debtor_document_files_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "debtor_documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "debtor_marketing_activity_files"
  ADD CONSTRAINT "debtor_marketing_activity_files_activity_id_fkey"
  FOREIGN KEY ("activity_id") REFERENCES "debtor_marketing_activities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "debtor_warning_letter_files"
  ADD CONSTRAINT "debtor_warning_letter_files_letter_id_fkey"
  FOREIGN KEY ("letter_id") REFERENCES "debtor_warning_letters"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "legal_document_template_files"
  ADD CONSTRAINT "legal_document_template_files_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "legal_document_templates"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "legal_print_history_files"
  ADD CONSTRAINT "legal_print_history_files_print_id_fkey"
  FOREIGN KEY ("print_id") REFERENCES "legal_print_histories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "legal_notary_progress_files"
  ADD CONSTRAINT "legal_notary_progress_files_progress_id_fkey"
  FOREIGN KEY ("progress_id") REFERENCES "legal_notary_progress"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "legal_insurance_progress_files"
  ADD CONSTRAINT "legal_insurance_progress_files_progress_id_fkey"
  FOREIGN KEY ("progress_id") REFERENCES "legal_insurance_progress"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "legal_kjpp_progress_files"
  ADD CONSTRAINT "legal_kjpp_progress_files_progress_id_fkey"
  FOREIGN KEY ("progress_id") REFERENCES "legal_kjpp_progress"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "legal_claim_files"
  ADD CONSTRAINT "legal_claim_files_claim_id_fkey"
  FOREIGN KEY ("claim_id") REFERENCES "legal_claims"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "legal_deposit_transaction_files"
  ADD CONSTRAINT "legal_deposit_transaction_files_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "legal_deposit_transactions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "debtor_document_files" ("id","document_id","file_path","file_name","mime_type","size_bytes","checksum","created_at","updated_at")
SELECT md5(d."id" || ':debtor-document:' || d."file_path"), d."id", d."file_path", d."file_name", d."mime_type", d."size_bytes", d."checksum", COALESCE(d."created_at", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "debtor_documents" d
WHERE d."deleted_at" IS NULL AND d."file_path" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "debtor_document_files" f WHERE f."document_id" = d."id" AND f."file_path" = d."file_path");

INSERT INTO "debtor_marketing_activity_files" ("id","activity_id","file_path","file_name","mime_type","size_bytes","checksum","created_at","updated_at")
SELECT md5(a."id" || ':marketing:' || a."file_path"), a."id", a."file_path", a."file_name", a."mime_type", a."size_bytes", a."checksum", COALESCE(a."created_at", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "debtor_marketing_activities" a
WHERE a."deleted_at" IS NULL AND a."file_path" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "debtor_marketing_activity_files" f WHERE f."activity_id" = a."id" AND f."file_path" = a."file_path");

INSERT INTO "debtor_warning_letter_files" ("id","letter_id","file_path","file_name","mime_type","size_bytes","checksum","created_at","updated_at")
SELECT md5(w."id" || ':warning:' || w."file_path"), w."id", w."file_path", w."file_name", w."mime_type", w."size_bytes", w."checksum", COALESCE(w."created_at", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "debtor_warning_letters" w
WHERE w."deleted_at" IS NULL AND w."file_path" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "debtor_warning_letter_files" f WHERE f."letter_id" = w."id" AND f."file_path" = w."file_path");

INSERT INTO "legal_document_template_files" ("id","template_id","file_path","file_name","mime_type","size_bytes","checksum","created_at","updated_at")
SELECT md5(t."id" || ':legal-template:' || t."file_path"), t."id", t."file_path", t."file_name", t."mime_type", t."size_bytes", t."checksum", COALESCE(t."created_at", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "legal_document_templates" t
WHERE t."deleted_at" IS NULL AND t."file_path" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "legal_document_template_files" f WHERE f."template_id" = t."id" AND f."file_path" = t."file_path");

INSERT INTO "legal_print_history_files" ("id","print_id","file_path","file_name","mime_type","size_bytes","checksum","created_at","updated_at")
SELECT md5(p."id" || ':legal-print:' || p."generated_file_path"), p."id", p."generated_file_path", p."generated_file_name", p."generated_mime_type", p."generated_size_bytes", NULL, COALESCE(p."created_at", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "legal_print_histories" p
WHERE p."deleted_at" IS NULL AND p."generated_file_path" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "legal_print_history_files" f WHERE f."print_id" = p."id" AND f."file_path" = p."generated_file_path");

INSERT INTO "legal_notary_progress_files" ("id","progress_id","file_path","file_name","mime_type","size_bytes","checksum","created_at","updated_at")
SELECT md5(n."id" || ':legal-notary:' || n."file_path"), n."id", n."file_path", n."file_name", n."mime_type", n."size_bytes", n."checksum", COALESCE(n."created_at", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "legal_notary_progress" n
WHERE n."deleted_at" IS NULL AND n."file_path" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "legal_notary_progress_files" f WHERE f."progress_id" = n."id" AND f."file_path" = n."file_path");

INSERT INTO "legal_insurance_progress_files" ("id","progress_id","file_path","file_name","mime_type","size_bytes","checksum","created_at","updated_at")
SELECT md5(i."id" || ':legal-insurance:' || i."file_path"), i."id", i."file_path", i."file_name", i."mime_type", i."size_bytes", i."checksum", COALESCE(i."created_at", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "legal_insurance_progress" i
WHERE i."deleted_at" IS NULL AND i."file_path" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "legal_insurance_progress_files" f WHERE f."progress_id" = i."id" AND f."file_path" = i."file_path");

INSERT INTO "legal_kjpp_progress_files" ("id","progress_id","file_path","file_name","mime_type","size_bytes","checksum","created_at","updated_at")
SELECT md5(k."id" || ':legal-kjpp:' || k."file_path"), k."id", k."file_path", k."file_name", k."mime_type", k."size_bytes", k."checksum", COALESCE(k."created_at", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "legal_kjpp_progress" k
WHERE k."deleted_at" IS NULL AND k."file_path" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "legal_kjpp_progress_files" f WHERE f."progress_id" = k."id" AND f."file_path" = k."file_path");

INSERT INTO "legal_claim_files" ("id","claim_id","file_path","file_name","mime_type","size_bytes","checksum","created_at","updated_at")
SELECT md5(c."id" || ':legal-claim:' || c."file_path"), c."id", c."file_path", c."file_name", c."mime_type", c."size_bytes", c."checksum", COALESCE(c."created_at", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "legal_claims" c
WHERE c."deleted_at" IS NULL AND c."file_path" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "legal_claim_files" f WHERE f."claim_id" = c."id" AND f."file_path" = c."file_path");

INSERT INTO "legal_deposit_transaction_files" ("id","transaction_id","file_path","file_name","mime_type","size_bytes","checksum","created_at","updated_at")
SELECT md5(t."id" || ':deposit-transaction:' || t."file_path"), t."id", t."file_path", t."file_name", t."mime_type", t."size_bytes", NULL, COALESCE(t."created_at", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "legal_deposit_transactions" t
WHERE t."file_path" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "legal_deposit_transaction_files" f WHERE f."transaction_id" = t."id" AND f."file_path" = t."file_path");
