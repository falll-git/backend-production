DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'role_types') THEN
    CREATE TYPE "role_types" AS ENUM ('MAIN', 'DIVISION');
  END IF;
END $$;

ALTER TABLE "roles"
ADD COLUMN IF NOT EXISTS "type" "role_types" NOT NULL DEFAULT 'DIVISION';

DO $$
DECLARE
  source_role_id TEXT;
  target_role_id TEXT;
BEGIN
  SELECT id INTO source_role_id
  FROM "roles"
  WHERE LOWER(BTRIM("name")) = 'manajer'
  LIMIT 1;

  SELECT id INTO target_role_id
  FROM "roles"
  WHERE LOWER(BTRIM("name")) = 'manager'
  LIMIT 1;

  IF source_role_id IS NOT NULL THEN
    IF target_role_id IS NULL THEN
      UPDATE "roles"
      SET "name" = 'Manager', "type" = 'MAIN'
      WHERE id = source_role_id;
    ELSE
      UPDATE "users"
      SET "role_id" = target_role_id
      WHERE "role_id" = source_role_id;

      UPDATE "role_menus" AS target
      SET
        "can_create" = target."can_create" OR source."can_create",
        "can_read" = target."can_read" OR source."can_read",
        "can_update" = target."can_update" OR source."can_update",
        "can_delete" = target."can_delete" OR source."can_delete",
        "updated_at" = NOW()
      FROM "role_menus" AS source
      WHERE target."role_id" = target_role_id
        AND source."role_id" = source_role_id
        AND target."menu_id" = source."menu_id";

      DELETE FROM "role_menus" AS source
      WHERE source."role_id" = source_role_id
        AND EXISTS (
          SELECT 1
          FROM "role_menus" AS target
          WHERE target."role_id" = target_role_id
            AND target."menu_id" = source."menu_id"
        );

      UPDATE "role_menus"
      SET "role_id" = target_role_id
      WHERE "role_id" = source_role_id;

      DELETE FROM "roles"
      WHERE id = source_role_id;
    END IF;
  END IF;

  SELECT id INTO source_role_id
  FROM "roles"
  WHERE LOWER(BTRIM("name")) = 'staff'
  LIMIT 1;

  SELECT id INTO target_role_id
  FROM "roles"
  WHERE LOWER(BTRIM("name")) = 'staf'
  LIMIT 1;

  IF source_role_id IS NOT NULL THEN
    IF target_role_id IS NULL THEN
      UPDATE "roles"
      SET "name" = 'Staf', "type" = 'MAIN'
      WHERE id = source_role_id;
    ELSE
      UPDATE "users"
      SET "role_id" = target_role_id
      WHERE "role_id" = source_role_id;

      UPDATE "role_menus" AS target
      SET
        "can_create" = target."can_create" OR source."can_create",
        "can_read" = target."can_read" OR source."can_read",
        "can_update" = target."can_update" OR source."can_update",
        "can_delete" = target."can_delete" OR source."can_delete",
        "updated_at" = NOW()
      FROM "role_menus" AS source
      WHERE target."role_id" = target_role_id
        AND source."role_id" = source_role_id
        AND target."menu_id" = source."menu_id";

      DELETE FROM "role_menus" AS source
      WHERE source."role_id" = source_role_id
        AND EXISTS (
          SELECT 1
          FROM "role_menus" AS target
          WHERE target."role_id" = target_role_id
            AND target."menu_id" = source."menu_id"
        );

      UPDATE "role_menus"
      SET "role_id" = target_role_id
      WHERE "role_id" = source_role_id;

      DELETE FROM "roles"
      WHERE id = source_role_id;
    END IF;
  END IF;
END $$;

UPDATE "roles"
SET "type" = 'MAIN'
WHERE LOWER(BTRIM("name")) IN ('admin', 'staf', 'supervisor', 'manager', 'it');

UPDATE "roles"
SET "type" = 'DIVISION'
WHERE LOWER(BTRIM("name")) NOT IN ('admin', 'staf', 'supervisor', 'manager', 'it');

DELETE FROM "role_menus"
WHERE "role_id" IN (
  SELECT id
  FROM "roles"
  WHERE LOWER(BTRIM("name")) <> 'it'
);

CREATE INDEX IF NOT EXISTS "roles_type_idx" ON "roles"("type");
