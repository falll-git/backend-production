-- Hak akses data Seputar Jaminan mengikuti menu child yang benar-benar
-- dikelola melalui Role-Menu. Parent hanya berfungsi sebagai pengelompokan
-- navigasi dan sengaja tidak memiliki baris role_menus.

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_has_global_access(capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.ruwang_arsip_sj_is_worker()
    OR public.ruwang_arsip_has_menu_permission(
      ARRAY[
        '/dashboard/seputar-jaminan/ringkasan',
        '/dashboard/seputar-jaminan/profil',
        '/dashboard/seputar-jaminan/kontak',
        '/dashboard/seputar-jaminan/publikasi',
        '/dashboard/seputar-jaminan/pengajuan'
      ]::text[],
      capability
    )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_can_access_division(
  target_division_id text,
  capability text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.ruwang_arsip_sj_is_worker()
    OR (
      public.ruwang_arsip_has_menu_permission(
        ARRAY[
          '/dashboard/seputar-jaminan/ringkasan',
          '/dashboard/seputar-jaminan/profil',
          '/dashboard/seputar-jaminan/kontak',
          '/dashboard/seputar-jaminan/publikasi',
          '/dashboard/seputar-jaminan/pengajuan'
        ]::text[],
        capability
      )
      AND (
        target_division_id = public.ruwang_arsip_current_user_division_id()
        OR public.ruwang_arsip_has_menu_feature(
          ARRAY[
            '/dashboard/seputar-jaminan/ringkasan',
            '/dashboard/seputar-jaminan/profil',
            '/dashboard/seputar-jaminan/kontak',
            '/dashboard/seputar-jaminan/publikasi',
            '/dashboard/seputar-jaminan/pengajuan'
          ]::text[],
          'sj_manage_all'
        )
      )
    )
$$;

