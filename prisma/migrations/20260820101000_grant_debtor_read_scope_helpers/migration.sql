-- Runtime RLS policies execute these helpers as the application role. Keep
-- PUBLIC revoked and grant only the least-privilege runtime role.
DO $grant_app$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_app') THEN
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_debtor_menu_urls()
      TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_compute_debtor_read_scope_mode()
      TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_debtor_read_scope_mode()
      TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_cached_current_user_division_id()
      TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_prepare_read_context()
      TO ruwang_arsip_app;
  END IF;
END
$grant_app$;
