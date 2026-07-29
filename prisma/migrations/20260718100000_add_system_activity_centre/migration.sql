CREATE TABLE "system_activity_logs" (
  "id" TEXT NOT NULL,
  "actor_id" TEXT,
  "module" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'API',
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "object_label" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "request_method" TEXT,
  "request_path" TEXT,
  "response_status" INTEGER,
  "request_id" TEXT,
  "before_data" JSONB,
  "after_data" JSONB,
  "metadata" JSONB,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "system_activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "system_activity_logs_created_at_idx" ON "system_activity_logs"("created_at");
CREATE INDEX "system_activity_logs_actor_id_created_at_idx" ON "system_activity_logs"("actor_id", "created_at");
CREATE INDEX "system_activity_logs_module_created_at_idx" ON "system_activity_logs"("module", "created_at");
CREATE INDEX "system_activity_logs_action_created_at_idx" ON "system_activity_logs"("action", "created_at");
CREATE INDEX "system_activity_logs_source_created_at_idx" ON "system_activity_logs"("source", "created_at");
CREATE INDEX "system_activity_logs_entity_type_entity_id_idx" ON "system_activity_logs"("entity_type", "entity_id");
CREATE INDEX "system_activity_logs_request_id_idx" ON "system_activity_logs"("request_id");

ALTER TABLE "system_activity_logs"
  ADD CONSTRAINT "system_activity_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "system_activity_logs" (
  "id",
  "actor_id",
  "module",
  "action",
  "source",
  "entity_type",
  "entity_id",
  "object_label",
  "title",
  "summary",
  "metadata",
  "created_at"
)
SELECT
  SUBSTRING(MD5('archive:' || activity."id"), 1, 8) || '-' ||
    SUBSTRING(MD5('archive:' || activity."id"), 9, 4) || '-4' ||
    SUBSTRING(MD5('archive:' || activity."id"), 14, 3) || '-a' ||
    SUBSTRING(MD5('archive:' || activity."id"), 18, 3) || '-' ||
    SUBSTRING(MD5('archive:' || activity."id"), 21, 12),
  activity."actor_id",
  'ARSIP_DIGITAL',
  activity."action"::TEXT,
  'MODULE_AUDIT',
  'DOKUMEN_DIGITAL',
  activity."document_id",
  COALESCE(document."document_number", document."document_name", activity."document_id"),
  activity."action"::TEXT || ' dokumen digital',
  activity."description",
  JSONB_STRIP_NULLS(JSONB_BUILD_OBJECT(
    'local_log_id', activity."id",
    'document_number', document."document_number",
    'document_name', document."document_name",
    'from_storage_id', activity."from_storage_id",
    'to_storage_id', activity."to_storage_id",
    'reference_type', activity."reference_type",
    'reference_id', activity."reference_id"
  )),
  activity."created_at"
FROM "storage_activity_logs" AS activity
LEFT JOIN "digital_documents" AS document
  ON document."id" = activity."document_id"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "system_activity_logs" (
  "id",
  "actor_id",
  "module",
  "action",
  "source",
  "entity_type",
  "entity_id",
  "object_label",
  "title",
  "summary",
  "before_data",
  "after_data",
  "metadata",
  "user_agent",
  "created_at"
)
SELECT
  SUBSTRING(MD5('debtor:' || activity."id"), 1, 8) || '-' ||
    SUBSTRING(MD5('debtor:' || activity."id"), 9, 4) || '-4' ||
    SUBSTRING(MD5('debtor:' || activity."id"), 14, 3) || '-a' ||
    SUBSTRING(MD5('debtor:' || activity."id"), 18, 3) || '-' ||
    SUBSTRING(MD5('debtor:' || activity."id"), 21, 12),
  activity."actor_id",
  'INFORMASI_DEBITUR',
  activity."action",
  activity."source",
  activity."entity_type",
  activity."entity_id",
  COALESCE(activity."title", debtor."name", contract."no_kontrak", activity."entity_id"),
  COALESCE(activity."title", activity."action" || ' ' || activity."entity_type"),
  activity."title",
  activity."before_data",
  activity."after_data",
  JSONB_STRIP_NULLS(COALESCE(activity."metadata", '{}'::JSONB) || JSONB_BUILD_OBJECT(
    'local_log_id', activity."id",
    'debtor_id', activity."debtor_id",
    'contract_id', activity."contract_id",
    'import_job_id', activity."import_job_id",
    'ideb_upload_id', activity."ideb_upload_id",
    'document_id', activity."document_id",
    'marketing_activity_id', activity."marketing_activity_id",
    'warning_letter_id', activity."warning_letter_id"
  )),
  activity."user_agent",
  activity."created_at"
FROM "debtor_activity_logs" AS activity
LEFT JOIN "digital_debtors" AS debtor
  ON debtor."id" = activity."debtor_id"
LEFT JOIN "debtor_contracts" AS contract
  ON contract."id" = activity."contract_id"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "system_activity_logs" (
  "id",
  "actor_id",
  "module",
  "action",
  "source",
  "entity_type",
  "entity_id",
  "object_label",
  "title",
  "summary",
  "before_data",
  "after_data",
  "metadata",
  "user_agent",
  "created_at"
)
SELECT
  SUBSTRING(MD5('legal:' || activity."id"), 1, 8) || '-' ||
    SUBSTRING(MD5('legal:' || activity."id"), 9, 4) || '-4' ||
    SUBSTRING(MD5('legal:' || activity."id"), 14, 3) || '-a' ||
    SUBSTRING(MD5('legal:' || activity."id"), 18, 3) || '-' ||
    SUBSTRING(MD5('legal:' || activity."id"), 21, 12),
  activity."actor_id",
  'MANAJEMEN_LEGAL',
  activity."action",
  activity."source",
  activity."entity_type",
  activity."entity_id",
  COALESCE(activity."title", debtor."name", contract."no_kontrak", activity."entity_id"),
  COALESCE(activity."title", activity."action" || ' ' || activity."entity_type"),
  activity."title",
  activity."before_data",
  activity."after_data",
  JSONB_STRIP_NULLS(COALESCE(activity."metadata", '{}'::JSONB) || JSONB_BUILD_OBJECT(
    'local_log_id', activity."id",
    'debtor_id', activity."debtor_id",
    'contract_id', activity."contract_id",
    'collateral_id', activity."collateral_id",
    'third_party_id', activity."third_party_id",
    'deposit_id', activity."deposit_id",
    'deposit_transaction_id', activity."deposit_transaction_id"
  )),
  activity."user_agent",
  activity."created_at"
FROM "legal_activity_logs" AS activity
LEFT JOIN "digital_debtors" AS debtor
  ON debtor."id" = activity."debtor_id"
LEFT JOIN "debtor_contracts" AS contract
  ON contract."id" = activity."contract_id"
ON CONFLICT ("id") DO NOTHING;

UPDATE "menus"
SET "order" = 7, "updated_at" = NOW()
WHERE "parent_id" IS NULL
  AND "name" = 'Parameter';

INSERT INTO "menus" (
  "id",
  "name",
  "icon",
  "url",
  "menu_type",
  "placement",
  "render_in_sidebar",
  "order",
  "created_at",
  "updated_at"
)
SELECT
  MD5('menu:/dashboard/activity-centre'),
  'Log Activity Centre',
  'lucide lucide-activity',
  '/dashboard/activity-centre',
  'NAVIGATION',
  'SIDEBAR',
  TRUE,
  6,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM "menus"
  WHERE "url" = '/dashboard/activity-centre'
);

UPDATE "menus"
SET
  "name" = 'Log Activity Centre',
  "icon" = 'lucide lucide-activity',
  "menu_type" = 'NAVIGATION',
  "placement" = 'SIDEBAR',
  "render_in_sidebar" = TRUE,
  "component_key" = NULL,
  "order" = 6,
  "updated_at" = NOW()
WHERE "url" = '/dashboard/activity-centre';

INSERT INTO "role_menus" (
  "id",
  "role_id",
  "menu_id",
  "can_create",
  "can_read",
  "can_update",
  "can_delete",
  "features",
  "created_at",
  "updated_at"
)
SELECT
  MD5('role-menu:' || role."id" || ':' || menu."id"),
  role."id",
  menu."id",
  FALSE,
  TRUE,
  FALSE,
  FALSE,
  ARRAY[]::TEXT[],
  NOW(),
  NOW()
FROM "roles" AS role
CROSS JOIN LATERAL (
  SELECT "id"
  FROM "menus"
  WHERE "url" = '/dashboard/activity-centre'
  ORDER BY "created_at" ASC
  LIMIT 1
) AS menu
WHERE LOWER(role."name") = 'admin'
ON CONFLICT ("role_id", "menu_id")
DO UPDATE SET
  "can_read" = TRUE,
  "updated_at" = NOW();
