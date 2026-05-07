ALTER TABLE "memorandums"
ADD COLUMN IF NOT EXISTS "origin_division_id" TEXT;

UPDATE "memorandums" AS memorandum
SET "origin_division_id" = COALESCE("user"."division_id", memorandum."division_id")
FROM "users" AS "user"
WHERE memorandum."created_by" = "user"."id"
  AND memorandum."origin_division_id" IS NULL;

UPDATE "memorandums"
SET "origin_division_id" = "division_id"
WHERE "origin_division_id" IS NULL;

ALTER TABLE "memorandums"
ALTER COLUMN "origin_division_id" SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE "memorandums"
  ADD CONSTRAINT "memorandums_origin_division_id_fkey"
  FOREIGN KEY ("origin_division_id") REFERENCES "divisions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "memorandums_origin_division_id_idx"
  ON "memorandums"("origin_division_id");

ALTER TABLE "memorandums"
DROP CONSTRAINT IF EXISTS "memorandums_division_id_fkey";

DROP INDEX IF EXISTS "memorandums_division_id_idx";

ALTER TABLE "memorandums"
DROP COLUMN IF EXISTS "division_id";
