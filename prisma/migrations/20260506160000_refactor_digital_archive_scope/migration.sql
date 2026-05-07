DROP INDEX IF EXISTS "digital_document_loans_active_document_key";
CREATE UNIQUE INDEX IF NOT EXISTS "digital_document_loans_active_document_key"
    ON "digital_document_loans"("document_id")
    WHERE "status" IN ('PENDING', 'APPROVED', 'HANDED_OVER', 'BORROWED');

CREATE TABLE IF NOT EXISTS "digital_debtors" (
    "id" TEXT NOT NULL,
    "debtor_number" TEXT,
    "name" TEXT NOT NULL,
    "identity_number" TEXT,
    "financing_number" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digital_debtors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "digital_debtors_debtor_number_key" ON "digital_debtors"("debtor_number");
CREATE UNIQUE INDEX IF NOT EXISTS "digital_debtors_identity_number_key" ON "digital_debtors"("identity_number");
CREATE INDEX IF NOT EXISTS "digital_debtors_name_idx" ON "digital_debtors"("name");
CREATE INDEX IF NOT EXISTS "digital_debtors_financing_number_idx" ON "digital_debtors"("financing_number");

ALTER TABLE "digital_documents"
    ADD COLUMN IF NOT EXISTS "owner_user_id" TEXT,
    ADD COLUMN IF NOT EXISTS "owner_division_id" TEXT,
    ADD COLUMN IF NOT EXISTS "debtor_id" TEXT,
    ADD COLUMN IF NOT EXISTS "document_date" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "due_date" TIMESTAMP(3);

UPDATE "digital_documents"
SET "owner_user_id" = "created_by"
WHERE "owner_user_id" IS NULL;

UPDATE "digital_documents" AS document
SET "owner_division_id" = "users"."division_id"
FROM "users"
WHERE document."owner_division_id" IS NULL
  AND document."owner_user_id" = "users"."id";

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'digital_documents_owner_user_id_fkey'
    ) THEN
        ALTER TABLE "digital_documents"
        ADD CONSTRAINT "digital_documents_owner_user_id_fkey"
        FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'digital_documents_owner_division_id_fkey'
    ) THEN
        ALTER TABLE "digital_documents"
        ADD CONSTRAINT "digital_documents_owner_division_id_fkey"
        FOREIGN KEY ("owner_division_id") REFERENCES "divisions"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'digital_documents_debtor_id_fkey'
    ) THEN
        ALTER TABLE "digital_documents"
        ADD CONSTRAINT "digital_documents_debtor_id_fkey"
        FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "digital_documents_owner_user_id_idx" ON "digital_documents"("owner_user_id");
CREATE INDEX IF NOT EXISTS "digital_documents_owner_division_id_idx" ON "digital_documents"("owner_division_id");
CREATE INDEX IF NOT EXISTS "digital_documents_debtor_id_idx" ON "digital_documents"("debtor_id");
CREATE INDEX IF NOT EXISTS "digital_documents_due_date_idx" ON "digital_documents"("due_date");

CREATE TABLE IF NOT EXISTS "digital_document_related_users" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digital_document_related_users_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'digital_document_related_users_document_id_fkey'
    ) THEN
        ALTER TABLE "digital_document_related_users"
        ADD CONSTRAINT "digital_document_related_users_document_id_fkey"
        FOREIGN KEY ("document_id") REFERENCES "digital_documents"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'digital_document_related_users_user_id_fkey'
    ) THEN
        ALTER TABLE "digital_document_related_users"
        ADD CONSTRAINT "digital_document_related_users_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "digital_document_related_users_document_id_user_id_key"
    ON "digital_document_related_users"("document_id", "user_id");
CREATE INDEX IF NOT EXISTS "digital_document_related_users_user_id_idx"
    ON "digital_document_related_users"("user_id");

UPDATE "digital_document_access_requests" AS request
SET "owner_id" = document."owner_user_id"
FROM "digital_documents" AS document
WHERE request."document_id" = document."id"
  AND document."owner_user_id" IS NOT NULL
  AND request."owner_id" <> document."owner_user_id";
