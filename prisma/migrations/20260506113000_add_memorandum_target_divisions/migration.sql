CREATE TABLE IF NOT EXISTS "memorandum_target_divisions" (
  "id" TEXT NOT NULL,
  "memorandums_id" TEXT NOT NULL,
  "division_id" TEXT NOT NULL,
  "manager_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "memorandum_target_divisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memorandum_target_divisions_memorandums_id_fkey"
    FOREIGN KEY ("memorandums_id") REFERENCES "memorandums"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "memorandum_target_divisions_division_id_fkey"
    FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "memorandum_target_divisions_manager_id_fkey"
    FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "memorandum_target_divisions_memorandums_id_division_id_key"
  ON "memorandum_target_divisions"("memorandums_id", "division_id");

CREATE INDEX IF NOT EXISTS "memorandum_target_divisions_division_id_idx"
  ON "memorandum_target_divisions"("division_id");

CREATE INDEX IF NOT EXISTS "memorandum_target_divisions_manager_id_idx"
  ON "memorandum_target_divisions"("manager_id");

INSERT INTO "memorandum_target_divisions" (
  "id",
  "memorandums_id",
  "division_id",
  "manager_id",
  "created_at",
  "updated_at"
)
SELECT
  md5("id" || "division_id" || clock_timestamp()::TEXT),
  "id",
  "division_id",
  NULL,
  "created_at",
  "updated_at"
FROM "memorandums"
WHERE "division_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "memorandum_target_divisions" AS target
    WHERE target."memorandums_id" = "memorandums"."id"
      AND target."division_id" = "memorandums"."division_id"
  );
