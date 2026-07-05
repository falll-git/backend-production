DROP INDEX IF EXISTS "outgoing_mails_send_due_date_idx";
DROP INDEX IF EXISTS "outgoing_mails_response_due_date_idx";

ALTER TABLE "outgoing_mails"
  DROP COLUMN IF EXISTS "send_due_date",
  DROP COLUMN IF EXISTS "response_due_date",
  DROP COLUMN IF EXISTS "follow_up_note";

WITH desired_role_features(role_name, menu_url, required_features) AS (
  VALUES
    (
      'Admin',
      '/dashboard/manajemen-surat/laporan',
      ARRAY['report_all', 'view_division']::TEXT[]
    ),
    (
      'Admin',
      '/dashboard/manajemen-surat/cetak-dokumen',
      ARRAY['report_all', 'view_division']::TEXT[]
    ),
    (
      'Manager',
      '/dashboard/manajemen-surat/laporan',
      ARRAY['view_division']::TEXT[]
    ),
    (
      'Manager',
      '/dashboard/manajemen-surat/cetak-dokumen',
      ARRAY['view_division']::TEXT[]
    ),
    (
      'Supervisor',
      '/dashboard/manajemen-surat/laporan',
      ARRAY['view_division']::TEXT[]
    ),
    (
      'Supervisor',
      '/dashboard/manajemen-surat/cetak-dokumen',
      ARRAY['view_division']::TEXT[]
    )
)
UPDATE "role_menus" rm
SET "features" = ARRAY(
  SELECT DISTINCT feature
  FROM unnest(
    COALESCE(rm."features", ARRAY[]::TEXT[]) || drf.required_features
  ) AS feature_list(feature)
  WHERE feature IS NOT NULL AND feature <> ''
  ORDER BY feature
)
FROM desired_role_features drf
JOIN "roles" r ON r."name" = drf.role_name
JOIN "menus" m ON m."url" = drf.menu_url
WHERE rm."role_id" = r."id"
  AND rm."menu_id" = m."id";
