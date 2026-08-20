SET ROLE ruwang_arsip_policy;

-- Reading a debtor report can inspect thousands of rows. The previous helpers
-- repeated the same role-menu joins for every row protected by RLS. Compute the
-- authenticated user's read mode once per transaction, while preserving the
-- existing ownership, division, manage_all, and report_all rules.
CREATE OR REPLACE FUNCTION public.ruwang_arsip_debtor_menu_urls()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    '/dashboard/informasi-debitur', '/dashboard/informasi-debitur/master-debitur',
    '/dashboard/informasi-debitur/marketing/action-plan', '/dashboard/informasi-debitur/marketing/hasil-kunjungan',
    '/dashboard/informasi-debitur/marketing/langkah-penanganan', '/dashboard/informasi-debitur/admin/upload-slik',
    '/dashboard/informasi-debitur/admin/monitoring-import', '/dashboard/informasi-debitur/admin/upload-ideb',
    '/dashboard/informasi-debitur/laporan-ideb', '/dashboard/informasi-debitur/laporan',
    '/dashboard/widgets/informasi-debitur/npf', '/dashboard/widgets/informasi-debitur/aktivitas-marketing',
    '/dashboard/legal/titipan/asuransi', '/dashboard/legal/titipan/notaris',
    '/dashboard/legal/titipan/angsuran', '/dashboard/legal/titipan/lainnya',
    '/dashboard/legal/progress/notaris', '/dashboard/legal/progress/asuransi',
    '/dashboard/legal/progress/kjpp', '/dashboard/legal/progress/klaim'
  ]::text[]
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_compute_debtor_read_scope_mode()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN NOT public.ruwang_arsip_has_menu_permission(
      public.ruwang_arsip_debtor_menu_urls(),
      'read'
    ) THEN 0
    WHEN public.ruwang_arsip_has_menu_feature(
      public.ruwang_arsip_debtor_menu_urls(),
      'manage_all'
    ) OR public.ruwang_arsip_has_menu_feature(
      public.ruwang_arsip_debtor_menu_urls(),
      'report_all'
    ) THEN 3
    WHEN public.ruwang_arsip_has_menu_feature(
      public.ruwang_arsip_debtor_menu_urls(),
      'view_division'
    ) THEN 2
    ELSE 1
  END
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_debtor_read_scope_mode()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN current_setting('app.debtor_read_scope_mode', true) ~ '^[0-3]$'
      THEN current_setting('app.debtor_read_scope_mode', true)::integer
    ELSE public.ruwang_arsip_compute_debtor_read_scope_mode()
  END
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_cached_current_user_division_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_user_division_id', true), ''),
    public.ruwang_arsip_current_user_division_id()
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_prepare_read_context()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  scope_mode integer;
  division_id text;
BEGIN
  scope_mode := public.ruwang_arsip_compute_debtor_read_scope_mode();
  division_id := public.ruwang_arsip_current_user_division_id();

  PERFORM set_config('app.debtor_read_scope_mode', scope_mode::text, true);
  PERFORM set_config(
    'app.current_user_division_id',
    COALESCE(division_id, ''),
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_read_debtor(target_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.digital_debtors debtor
    LEFT JOIN public.users marketing_user ON marketing_user.id = debtor.marketing_user_id
    WHERE debtor.id = target_id
      AND debtor.deleted_at IS NULL
      AND public.ruwang_arsip_debtor_read_scope_mode() > 0
      AND (
        public.ruwang_arsip_debtor_read_scope_mode() >= 3
        OR debtor.created_by = public.ruwang_arsip_current_user_id()
        OR debtor.marketing_user_id = public.ruwang_arsip_current_user_id()
        OR EXISTS (
          SELECT 1
          FROM public.debtor_contracts contract
          WHERE contract.debtor_id = debtor.id
            AND (
              contract.created_by = public.ruwang_arsip_current_user_id()
              OR contract.marketing_user_id = public.ruwang_arsip_current_user_id()
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.debtor_marketing_activities activity
          WHERE activity.debtor_id = debtor.id
            AND activity.created_by = public.ruwang_arsip_current_user_id()
        )
        OR (
          public.ruwang_arsip_debtor_read_scope_mode() >= 2
          AND (
            marketing_user.division_id = public.ruwang_arsip_cached_current_user_division_id()
            OR EXISTS (
              SELECT 1
              FROM public.debtor_contracts contract
              JOIN public.users contract_marketing
                ON contract_marketing.id = contract.marketing_user_id
              WHERE contract.debtor_id = debtor.id
                AND contract_marketing.division_id = public.ruwang_arsip_cached_current_user_division_id()
            )
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_read_contract(target_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.debtor_contracts contract
    LEFT JOIN public.users marketing_user ON marketing_user.id = contract.marketing_user_id
    LEFT JOIN public.digital_debtors debtor ON debtor.id = contract.debtor_id
    LEFT JOIN public.users debtor_marketing ON debtor_marketing.id = debtor.marketing_user_id
    WHERE contract.id = target_id
      AND contract.deleted_at IS NULL
      AND public.ruwang_arsip_debtor_read_scope_mode() > 0
      AND (
        public.ruwang_arsip_debtor_read_scope_mode() >= 3
        OR contract.created_by = public.ruwang_arsip_current_user_id()
        OR contract.marketing_user_id = public.ruwang_arsip_current_user_id()
        OR debtor.created_by = public.ruwang_arsip_current_user_id()
        OR debtor.marketing_user_id = public.ruwang_arsip_current_user_id()
        OR (
          public.ruwang_arsip_debtor_read_scope_mode() >= 2
          AND (
            marketing_user.division_id = public.ruwang_arsip_cached_current_user_division_id()
            OR debtor_marketing.division_id = public.ruwang_arsip_cached_current_user_division_id()
          )
        )
      )
  )
$$;

ALTER FUNCTION public.ruwang_arsip_debtor_menu_urls() OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_compute_debtor_read_scope_mode() OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_debtor_read_scope_mode() OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_cached_current_user_division_id() OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_prepare_read_context() OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_read_debtor(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_read_contract(text) OWNER TO ruwang_arsip_policy;

REVOKE ALL ON FUNCTION public.ruwang_arsip_debtor_menu_urls() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_compute_debtor_read_scope_mode() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_debtor_read_scope_mode() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_cached_current_user_division_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_prepare_read_context() FROM PUBLIC;

DO $grant_app$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_app') THEN
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_prepare_read_context()
      TO ruwang_arsip_app;
  END IF;
END
$grant_app$;

RESET ROLE;
