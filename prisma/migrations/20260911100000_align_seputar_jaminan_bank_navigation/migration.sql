-- Menata navigasi bank menjadi satu parent dengan lima child tanpa full seed.
-- Permission lama dipindahkan secara terarah agar akses yang sudah ada tetap
-- berlaku, sementara parent tidak menjadi jalur akses mandiri.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "menus"
    WHERE "url" = '/dashboard/seputar-jaminan/katalog'
  ) AND EXISTS (
    SELECT 1 FROM "menus"
    WHERE "url" = '/dashboard/seputar-jaminan/publikasi'
  ) THEN
    RAISE EXCEPTION 'Menu SJ lama dan baru untuk publikasi ditemukan bersamaan';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "menus"
    WHERE "url" = '/dashboard/seputar-jaminan/pemeriksaan'
  ) AND EXISTS (
    SELECT 1 FROM "menus"
    WHERE "url" = '/dashboard/seputar-jaminan/pengajuan'
  ) THEN
    RAISE EXCEPTION 'Menu SJ lama dan baru untuk pengajuan ditemukan bersamaan';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "menus"
    WHERE "url" = '/dashboard/seputar-jaminan/profil-kontak'
  ) AND EXISTS (
    SELECT 1 FROM "menus"
    WHERE "url" = '/dashboard/seputar-jaminan/profil'
  ) THEN
    RAISE EXCEPTION 'Menu SJ lama dan baru untuk profil ditemukan bersamaan';
  END IF;
END $$;

INSERT INTO "menus" (
  "id", "name", "url", "icon", "order", "parent_id", "parent",
  "menu_type", "placement", "render_in_sidebar", "component_key",
  "created_at", "updated_at"
)
SELECT
  '8b9e8dd4-8df6-4b7d-83fb-0bcd71be7e00',
  'Seputar Jaminan',
  '/dashboard/seputar-jaminan',
  'lucide lucide-store',
  6,
  NULL,
  NULL,
  'NAVIGATION',
  'SIDEBAR',
  true,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "menus"
  WHERE "url" = '/dashboard/seputar-jaminan'
);

UPDATE "menus"
SET
  "name" = 'Daftar Publikasi',
  "url" = '/dashboard/seputar-jaminan/publikasi',
  "icon" = 'lucide lucide-layout-grid',
  "order" = 4,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "url" = '/dashboard/seputar-jaminan/katalog';

UPDATE "menus"
SET
  "name" = 'Pengajuan',
  "url" = '/dashboard/seputar-jaminan/pengajuan',
  "icon" = 'lucide lucide-clipboard-list',
  "order" = 5,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "url" = '/dashboard/seputar-jaminan/pemeriksaan';

UPDATE "menus"
SET
  "name" = 'Profil BPRS',
  "url" = '/dashboard/seputar-jaminan/profil',
  "icon" = 'lucide lucide-building-2',
  "order" = 2,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "url" = '/dashboard/seputar-jaminan/profil-kontak';

INSERT INTO "menus" (
  "id", "name", "url", "icon", "order", "parent_id", "parent",
  "menu_type", "placement", "render_in_sidebar", "component_key",
  "created_at", "updated_at"
)
SELECT
  child."id",
  child."name",
  child."url",
  child."icon",
  child."sort_order",
  parent."id",
  parent."name",
  'NAVIGATION',
  'SIDEBAR',
  true,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "menus" parent
JOIN (
  VALUES
    ('8b9e8dd4-8df6-4b7d-83fb-0bcd71be7e01', 'Ringkasan', '/dashboard/seputar-jaminan/ringkasan', 'lucide lucide-layout-dashboard', 1),
    ('8b9e8dd4-8df6-4b7d-83fb-0bcd71be7e03', 'Profil BPRS', '/dashboard/seputar-jaminan/profil', 'lucide lucide-building-2', 2),
    ('8b9e8dd4-8df6-4b7d-83fb-0bcd71be7e02', 'Kontak WhatsApp', '/dashboard/seputar-jaminan/kontak', 'lucide lucide-message-circle', 3),
    ('8b9e8dd4-8df6-4b7d-83fb-0bcd71be7e04', 'Daftar Publikasi', '/dashboard/seputar-jaminan/publikasi', 'lucide lucide-layout-grid', 4),
    ('8b9e8dd4-8df6-4b7d-83fb-0bcd71be7e05', 'Pengajuan', '/dashboard/seputar-jaminan/pengajuan', 'lucide lucide-clipboard-list', 5)
) AS child("id", "name", "url", "icon", "sort_order") ON true
WHERE parent."url" = '/dashboard/seputar-jaminan'
  AND NOT EXISTS (
    SELECT 1 FROM "menus"
    WHERE "url" = child."url"
  );

UPDATE "menus" child
SET
  "parent_id" = parent."id",
  "parent" = parent."name",
  "menu_type" = 'NAVIGATION',
  "placement" = 'SIDEBAR',
  "render_in_sidebar" = true,
  "component_key" = NULL,
  "updated_at" = CURRENT_TIMESTAMP
FROM "menus" parent
WHERE parent."url" = '/dashboard/seputar-jaminan'
  AND child."url" = ANY (ARRAY[
    '/dashboard/seputar-jaminan/ringkasan',
    '/dashboard/seputar-jaminan/profil',
    '/dashboard/seputar-jaminan/kontak',
    '/dashboard/seputar-jaminan/publikasi',
    '/dashboard/seputar-jaminan/pengajuan'
  ]);

-- Hak parent lama menjadi hak Ringkasan. Fitur keputusan tidak ikut ke
-- Ringkasan; hanya operasional sinkronisasi dan cakupan divisi.
INSERT INTO "role_menus" (
  "id", "role_id", "menu_id", "can_create", "can_read", "can_update",
  "can_delete", "features", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  source."role_id",
  summary."id",
  false,
  source."can_read",
  source."can_update",
  false,
  ARRAY(
    SELECT DISTINCT feature
    FROM unnest(COALESCE(source."features", ARRAY[]::text[])) feature
    WHERE feature = ANY (ARRAY['sj_reconfirm', 'sj_sync_retry', 'sj_manage_all'])
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "role_menus" source
JOIN "menus" root ON root."id" = source."menu_id"
JOIN "menus" summary ON summary."url" = '/dashboard/seputar-jaminan/ringkasan'
WHERE root."url" = '/dashboard/seputar-jaminan'
ON CONFLICT ("role_id", "menu_id") DO UPDATE SET
  "can_read" = "role_menus"."can_read" OR EXCLUDED."can_read",
  "can_update" = "role_menus"."can_update" OR EXCLUDED."can_update",
  "features" = ARRAY(
    SELECT DISTINCT feature
    FROM unnest("role_menus"."features" || EXCLUDED."features") feature
  ),
  "updated_at" = CURRENT_TIMESTAMP;

-- Permission Profil & Kontak lama tetap menjadi permission Profil. Salin
-- hanya capability bank yang relevan ke child Kontak WhatsApp baru.
INSERT INTO "role_menus" (
  "id", "role_id", "menu_id", "can_create", "can_read", "can_update",
  "can_delete", "features", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  source."role_id",
  contacts."id",
  source."can_create",
  source."can_read",
  source."can_update",
  false,
  ARRAY[]::text[],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "role_menus" source
JOIN "menus" profile ON profile."id" = source."menu_id"
JOIN "menus" contacts ON contacts."url" = '/dashboard/seputar-jaminan/kontak'
WHERE profile."url" = '/dashboard/seputar-jaminan/profil'
ON CONFLICT ("role_id", "menu_id") DO NOTHING;

-- Feature pemeriksaan lama pada parent dipindahkan ke Pengajuan agar jalur
-- lokal lama tetap dapat dipakai sampai authority bank dialihkan eksplisit.
-- Gunakan upsert karena beberapa instalasi lama hanya mempunyai permission
-- pada parent dan belum mempunyai baris permission Pemeriksaan tersendiri.
INSERT INTO "role_menus" (
  "id", "role_id", "menu_id", "can_create", "can_read", "can_update",
  "can_delete", "features", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  source."role_id",
  submissions."id",
  false,
  source."can_read",
  source."can_update",
  false,
  ARRAY(
    SELECT DISTINCT feature
    FROM unnest(COALESCE(source."features", ARRAY[]::text[])) feature
    WHERE feature = ANY (ARRAY[
      'sj_review', 'sj_publish', 'sj_unpublish', 'sj_archive',
      'sj_contact_verify', 'sj_profile_verify'
    ])
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "role_menus" source
JOIN "menus" root ON root."id" = source."menu_id"
JOIN "menus" submissions ON submissions."url" = '/dashboard/seputar-jaminan/pengajuan'
WHERE root."url" = '/dashboard/seputar-jaminan'
  AND source."can_read" = true
ON CONFLICT ("role_id", "menu_id") DO UPDATE SET
  "can_read" = "role_menus"."can_read" OR EXCLUDED."can_read",
  "can_update" = "role_menus"."can_update" OR EXCLUDED."can_update",
  "features" = ARRAY(
    SELECT DISTINCT feature
    FROM unnest("role_menus"."features" || EXCLUDED."features") feature
  ),
  "updated_at" = CURRENT_TIMESTAMP;

-- Parent hanya ikut terlihat karena salah satu child dapat dibaca.
DELETE FROM "role_menus"
WHERE "menu_id" IN (
  SELECT "id" FROM "menus"
  WHERE "url" = '/dashboard/seputar-jaminan'
);

-- Tidak ada delete langsung dari bank untuk profil, kontak, atau publikasi.
UPDATE "role_menus" permission
SET "can_delete" = false, "updated_at" = CURRENT_TIMESTAMP
FROM "menus" menu
WHERE permission."menu_id" = menu."id"
  AND menu."url" = ANY (ARRAY[
    '/dashboard/seputar-jaminan/profil',
    '/dashboard/seputar-jaminan/kontak',
    '/dashboard/seputar-jaminan/publikasi'
  ]);

DO $$
DECLARE
  root_id text;
  child_count integer;
BEGIN
  SELECT "id" INTO root_id
  FROM "menus"
  WHERE "url" = '/dashboard/seputar-jaminan';

  IF root_id IS NULL THEN
    RAISE EXCEPTION 'Parent Seputar Jaminan tidak ditemukan';
  END IF;

  SELECT COUNT(*) INTO child_count
  FROM "menus"
  WHERE "parent_id" = root_id;

  IF child_count <> 5 THEN
    RAISE EXCEPTION 'Parent Seputar Jaminan wajib memiliki tepat lima child';
  END IF;

  SELECT COUNT(*) INTO child_count
  FROM "menus"
  WHERE "parent_id" = root_id AND "url" = ANY (ARRAY[
      '/dashboard/seputar-jaminan/ringkasan',
      '/dashboard/seputar-jaminan/profil',
      '/dashboard/seputar-jaminan/kontak',
      '/dashboard/seputar-jaminan/publikasi',
      '/dashboard/seputar-jaminan/pengajuan'
    ]);

  IF child_count <> 5 THEN
    RAISE EXCEPTION 'Lima child Seputar Jaminan belum lengkap';
  END IF;
END $$;
