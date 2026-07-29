DROP POLICY IF EXISTS digital_documents_update_scope ON public.digital_documents;
DROP POLICY IF EXISTS digital_documents_delete_scope ON public.digital_documents;

CREATE POLICY digital_documents_update_scope
  ON public.digital_documents
  FOR UPDATE
  USING (public.ruwang_arsip_can_manage_digital_document_id(id, 'update'))
  WITH CHECK (
    public.ruwang_arsip_can_manage_digital_document_id(id, 'update')
    AND (
      (access_level::text <> 'RESTRICT' AND NOT is_restricted)
      OR public.ruwang_arsip_current_user_can_access_restricted()
    )
  );

CREATE POLICY digital_documents_delete_scope
  ON public.digital_documents
  FOR DELETE
  USING (public.ruwang_arsip_can_manage_digital_document_id(id, 'delete'));

DROP FUNCTION IF EXISTS public.ruwang_arsip_can_read_digital_document(
  text, text, text, text, text, boolean
);
DROP FUNCTION IF EXISTS public.ruwang_arsip_can_manage_digital_document(text, text);

REVOKE ALL ON FUNCTION public.ruwang_arsip_current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_current_access_purpose() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_has_menu_permission(text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_has_menu_feature(text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_current_user_division_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_current_user_can_access_restricted() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ruwang_arsip_current_user_id() TO ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_current_access_purpose() TO ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_has_menu_permission(text[], text) TO ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_has_menu_feature(text[], text) TO ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_current_user_division_id() TO ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_current_user_can_access_restricted() TO ruwang_arsip_policy;

DO $grant_app$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_app') THEN
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_current_user_id() TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_current_access_purpose() TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_has_menu_permission(text[], text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_has_menu_feature(text[], text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_current_user_division_id() TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_current_user_can_access_restricted() TO ruwang_arsip_app;
  END IF;
END
$grant_app$;
