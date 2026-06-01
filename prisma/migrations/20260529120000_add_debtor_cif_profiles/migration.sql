ALTER TABLE "digital_debtors"
  ADD COLUMN IF NOT EXISTS "customer_type" TEXT,
  ADD COLUMN IF NOT EXISTS "slik_segment" TEXT,
  ADD COLUMN IF NOT EXISTS "slik_status_code" TEXT,
  ADD COLUMN IF NOT EXISTS "slik_operation_code" TEXT;

CREATE INDEX IF NOT EXISTS "digital_debtors_customer_type_idx"
  ON "digital_debtors"("customer_type");
CREATE INDEX IF NOT EXISTS "digital_debtors_slik_segment_idx"
  ON "digital_debtors"("slik_segment");
CREATE INDEX IF NOT EXISTS "digital_debtors_slik_status_code_idx"
  ON "digital_debtors"("slik_status_code");

CREATE TABLE IF NOT EXISTS "debtor_individual_profiles" (
  "id" TEXT NOT NULL,
  "debtor_id" TEXT NOT NULL,
  "identity_type_code" TEXT,
  "name_as_identity" TEXT,
  "full_name" TEXT,
  "education_degree_code" TEXT,
  "gender" TEXT,
  "birth_place" TEXT,
  "birth_date" TIMESTAMP(3),
  "tax_number" TEXT,
  "address_detail" TEXT,
  "village" TEXT,
  "district" TEXT,
  "city_code" TEXT,
  "postal_code" TEXT,
  "phone" TEXT,
  "mobile_phone" TEXT,
  "email" TEXT,
  "domicile_country_code" TEXT,
  "occupation_code" TEXT,
  "workplace" TEXT,
  "workplace_business_field_code" TEXT,
  "workplace_address" TEXT,
  "annual_gross_income" DECIMAL(18,2),
  "income_source_code" TEXT,
  "dependent_count" INTEGER,
  "relationship_with_reporter_code" TEXT,
  "debtor_group_code" TEXT,
  "marital_status_code" TEXT,
  "spouse_identity_number" TEXT,
  "spouse_name" TEXT,
  "spouse_birth_date" TIMESTAMP(3),
  "separate_assets_agreement" TEXT,
  "violates_bmpk" TEXT,
  "exceeds_bmpk" TEXT,
  "mother_maiden_name" TEXT,
  "branch_code" TEXT,
  "operation_code" TEXT,
  "status_code" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debtor_individual_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "debtor_individual_profiles_debtor_id_key"
  ON "debtor_individual_profiles"("debtor_id");
CREATE INDEX IF NOT EXISTS "debtor_individual_profiles_branch_code_idx"
  ON "debtor_individual_profiles"("branch_code");
CREATE INDEX IF NOT EXISTS "debtor_individual_profiles_status_code_idx"
  ON "debtor_individual_profiles"("status_code");

CREATE TABLE IF NOT EXISTS "debtor_legal_entity_profiles" (
  "id" TEXT NOT NULL,
  "debtor_id" TEXT NOT NULL,
  "business_identity_number" TEXT,
  "business_name" TEXT,
  "legal_form_code" TEXT,
  "establishment_place" TEXT,
  "establishment_deed_number" TEXT,
  "establishment_deed_date" TIMESTAMP(3),
  "latest_amendment_deed_number" TEXT,
  "latest_amendment_deed_date" TIMESTAMP(3),
  "phone" TEXT,
  "mobile_phone" TEXT,
  "email" TEXT,
  "address_detail" TEXT,
  "village" TEXT,
  "district" TEXT,
  "city_code" TEXT,
  "postal_code" TEXT,
  "domicile_country_code" TEXT,
  "business_field_code" TEXT,
  "relationship_with_reporter_code" TEXT,
  "violates_bmpk" TEXT,
  "exceeds_bmpk" TEXT,
  "go_public" TEXT,
  "debtor_group_code" TEXT,
  "rating" TEXT,
  "rating_agency" TEXT,
  "rating_date" TIMESTAMP(3),
  "debtor_group_name" TEXT,
  "branch_code" TEXT,
  "operation_code" TEXT,
  "status_code" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debtor_legal_entity_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "debtor_legal_entity_profiles_debtor_id_key"
  ON "debtor_legal_entity_profiles"("debtor_id");
CREATE INDEX IF NOT EXISTS "debtor_legal_entity_profiles_branch_code_idx"
  ON "debtor_legal_entity_profiles"("branch_code");
CREATE INDEX IF NOT EXISTS "debtor_legal_entity_profiles_status_code_idx"
  ON "debtor_legal_entity_profiles"("status_code");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'debtor_individual_profiles_debtor_id_fkey'
  ) THEN
    ALTER TABLE "debtor_individual_profiles"
      ADD CONSTRAINT "debtor_individual_profiles_debtor_id_fkey"
      FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'debtor_legal_entity_profiles_debtor_id_fkey'
  ) THEN
    ALTER TABLE "debtor_legal_entity_profiles"
      ADD CONSTRAINT "debtor_legal_entity_profiles_debtor_id_fkey"
      FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

UPDATE "digital_debtors" d
SET
  "customer_type" = 'INDIVIDUAL',
  "slik_segment" = 'D01',
  "slik_status_code" = 'I'
FROM (
  SELECT DISTINCT ON ("debtor_id") "debtor_id"
  FROM "debtor_slik_records"
  WHERE "debtor_id" IS NOT NULL AND "segment" = 'D01'
  ORDER BY "debtor_id", "created_at" DESC
) s
WHERE d."id" = s."debtor_id"
  AND d."customer_type" IS NULL;

UPDATE "digital_debtors" d
SET
  "customer_type" = 'LEGAL_ENTITY',
  "slik_segment" = 'D02',
  "slik_status_code" = 'B'
FROM (
  SELECT DISTINCT ON ("debtor_id") "debtor_id"
  FROM "debtor_slik_records"
  WHERE "debtor_id" IS NOT NULL AND "segment" = 'D02'
  ORDER BY "debtor_id", "created_at" DESC
) s
WHERE d."id" = s."debtor_id"
  AND d."customer_type" IS NULL;
