UPDATE "menus"
SET
  "name" = 'Log Activity Center',
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
WHERE LOWER(role."name") IN ('admin', 'manager')
ON CONFLICT ("role_id", "menu_id")
DO UPDATE SET
  "can_read" = TRUE,
  "updated_at" = NOW();
