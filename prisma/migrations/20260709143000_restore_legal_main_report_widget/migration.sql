DO $$
DECLARE
  legal_parent_id TEXT;
BEGIN
  SELECT "id"
  INTO legal_parent_id
  FROM "menus"
  WHERE "url" = '/dashboard/legal'
  ORDER BY "created_at" ASC
  LIMIT 1;

  IF legal_parent_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM "menus"
       WHERE "url" = '/dashboard/legal/laporan'
     ) THEN
    INSERT INTO "menus" (
      "id",
      "name",
      "parent_id",
      "parent",
      "icon",
      "url",
      "menu_type",
      "placement",
      "render_in_sidebar",
      "component_key",
      "order",
      "created_at",
      "updated_at"
    )
    VALUES (
      md5('menu:/dashboard/legal/laporan'),
      'Laporan Legal',
      legal_parent_id,
      'Manajemen Legal',
      'lucide lucide-clipboard-list',
      '/dashboard/legal/laporan',
      'DASHBOARD_WIDGET',
      'DASHBOARD',
      TRUE,
      'dashboard.module_report.legal',
      3,
      NOW(),
      NOW()
    );
  END IF;
END $$;

UPDATE "menus"
SET
  "name" = 'Laporan Legal',
  "icon" = 'lucide lucide-clipboard-list',
  "menu_type" = 'DASHBOARD_WIDGET',
  "placement" = 'DASHBOARD',
  "render_in_sidebar" = TRUE,
  "component_key" = 'dashboard.module_report.legal',
  "order" = 3,
  "updated_at" = NOW()
WHERE "url" = '/dashboard/legal/laporan';

WITH report_menu AS (
  SELECT "id"
  FROM "menus"
  WHERE "url" = '/dashboard/legal/laporan'
  ORDER BY "created_at" ASC
  LIMIT 1
),
eligible_roles AS (
  SELECT
    role_menu."role_id",
    BOOL_OR(
      'report_all' = ANY(COALESCE(role_menu."features", ARRAY[]::TEXT[]))
      OR 'manage_all' = ANY(COALESCE(role_menu."features", ARRAY[]::TEXT[]))
    ) AS can_report_all,
    BOOL_OR(
      'view_division' = ANY(COALESCE(role_menu."features", ARRAY[]::TEXT[]))
    ) AS can_view_division
  FROM "role_menus" AS role_menu
  INNER JOIN "menus" AS source_menu
    ON source_menu."id" = role_menu."menu_id"
  WHERE role_menu."can_read" = TRUE
    AND source_menu."url" IN (
      '/dashboard/legal',
      '/dashboard/legal/progress/notaris',
      '/dashboard/legal/progress/asuransi',
      '/dashboard/legal/progress/kjpp',
      '/dashboard/legal/progress/klaim',
      '/dashboard/legal/titipan/notaris',
      '/dashboard/legal/titipan/asuransi',
      '/dashboard/legal/titipan/angsuran',
      '/dashboard/legal/titipan/lainnya',
      '/dashboard/legal/laporan',
      '/dashboard/legal/laporan/pihak-ketiga/dokumen',
      '/dashboard/legal/laporan/pihak-ketiga/dana-titipan'
    )
  GROUP BY role_menu."role_id"
),
desired_access AS (
  SELECT
    eligible_role."role_id",
    report_menu."id" AS menu_id,
    ARRAY_REMOVE(
      ARRAY[
        CASE WHEN eligible_role.can_report_all THEN 'report_all' END,
        CASE WHEN eligible_role.can_view_division THEN 'view_division' END
      ]::TEXT[],
      NULL
    ) AS features
  FROM eligible_roles AS eligible_role
  CROSS JOIN report_menu
)
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
  md5('role-menu:' || desired_access."role_id" || ':' || desired_access.menu_id),
  desired_access."role_id",
  desired_access.menu_id,
  FALSE,
  TRUE,
  FALSE,
  FALSE,
  desired_access.features,
  NOW(),
  NOW()
FROM desired_access
ON CONFLICT ("role_id", "menu_id")
DO UPDATE SET
  "can_read" = TRUE,
  "features" = (
    SELECT ARRAY(
      SELECT DISTINCT feature
      FROM UNNEST(
        COALESCE("role_menus"."features", ARRAY[]::TEXT[])
        || EXCLUDED."features"
      ) AS feature
      ORDER BY feature
    )
  ),
  "updated_at" = NOW();
