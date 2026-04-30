-- CreateTable
CREATE TABLE "storage_offices" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_offices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_cabinets" (
    "id" TEXT NOT NULL,
    "office_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_cabinets_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "storages" ADD COLUMN "cabinet_id" TEXT;

-- Migrate existing flat storage rows into office and cabinet hierarchy
WITH normalized_storages AS (
    SELECT
        "id",
        COALESCE(NULLIF(BTRIM("office_code"), ''), 'OFFICE-' || SUBSTRING(MD5("id" || '-office') FOR 8)) AS office_code_key,
        COALESCE(
            NULLIF(BTRIM("office_label"), ''),
            NULLIF(BTRIM("office_code"), ''),
            'Unknown Office'
        ) AS office_name_key,
        COALESCE(NULLIF(BTRIM("code"), ''), 'CAB-' || SUBSTRING(MD5("id" || '-cabinet') FOR 8)) AS cabinet_code_key
    FROM "storages"
)
INSERT INTO "storage_offices" ("id", "code", "name", "created_at", "updated_at")
SELECT
    'office_' || MD5(office_code_key),
    office_code_key,
    office_name_key,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON (office_code_key)
        office_code_key,
        office_name_key
    FROM normalized_storages
    ORDER BY office_code_key, office_name_key
) AS distinct_offices;

WITH normalized_storages AS (
    SELECT
        "id",
        COALESCE(NULLIF(BTRIM("office_code"), ''), 'OFFICE-' || SUBSTRING(MD5("id" || '-office') FOR 8)) AS office_code_key,
        COALESCE(NULLIF(BTRIM("code"), ''), 'CAB-' || SUBSTRING(MD5("id" || '-cabinet') FOR 8)) AS cabinet_code_key
    FROM "storages"
)
INSERT INTO "storage_cabinets" ("id", "office_id", "code", "created_at", "updated_at")
SELECT
    'cabinet_' || MD5(so."id" || '::' || distinct_cabinets.cabinet_code_key),
    so."id",
    distinct_cabinets.cabinet_code_key,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT
        office_code_key,
        cabinet_code_key
    FROM normalized_storages
) AS distinct_cabinets
JOIN "storage_offices" so
    ON so."code" = distinct_cabinets.office_code_key;

WITH normalized_storages AS (
    SELECT
        "id",
        COALESCE(NULLIF(BTRIM("office_code"), ''), 'OFFICE-' || SUBSTRING(MD5("id" || '-office') FOR 8)) AS office_code_key,
        COALESCE(NULLIF(BTRIM("code"), ''), 'CAB-' || SUBSTRING(MD5("id" || '-cabinet') FOR 8)) AS cabinet_code_key
    FROM "storages"
)
UPDATE "storages" s
SET "cabinet_id" = sc."id"
FROM normalized_storages ns
JOIN "storage_offices" so
    ON so."code" = ns.office_code_key
JOIN "storage_cabinets" sc
    ON sc."office_id" = so."id"
   AND sc."code" = ns.cabinet_code_key
WHERE s."id" = ns."id";

ALTER TABLE "storages" ALTER COLUMN "cabinet_id" SET NOT NULL;

-- Drop old flat hierarchy columns after data migration
ALTER TABLE "storages"
    DROP COLUMN "code",
    DROP COLUMN "office_code",
    DROP COLUMN "office_label";

-- CreateIndex
CREATE UNIQUE INDEX "storage_offices_code_key" ON "storage_offices"("code");

-- CreateIndex
CREATE INDEX "storage_cabinets_office_id_idx" ON "storage_cabinets"("office_id");

-- CreateIndex
CREATE UNIQUE INDEX "storage_cabinets_office_id_code_key" ON "storage_cabinets"("office_id", "code");

-- CreateIndex
CREATE INDEX "storages_cabinet_id_idx" ON "storages"("cabinet_id");

-- CreateIndex
CREATE UNIQUE INDEX "storages_cabinet_id_name_key" ON "storages"("cabinet_id", "name");

-- AddForeignKey
ALTER TABLE "storage_cabinets" ADD CONSTRAINT "storage_cabinets_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "storage_offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storages" ADD CONSTRAINT "storages_cabinet_id_fkey" FOREIGN KEY ("cabinet_id") REFERENCES "storage_cabinets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
