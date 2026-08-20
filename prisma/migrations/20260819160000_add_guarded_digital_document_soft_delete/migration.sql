CREATE OR REPLACE FUNCTION public.ruwang_arsip_soft_delete_digital_document(
  target_document_id text,
  actor_user_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF actor_user_id IS DISTINCT FROM public.ruwang_arsip_current_user_id() THEN
    RETURN false;
  END IF;

  IF NOT public.ruwang_arsip_can_manage_digital_document_id(
    target_document_id,
    'delete'
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.digital_documents
  SET deleted_by = actor_user_id,
      deleted_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = target_document_id
    AND deleted_at IS NULL;

  RETURN FOUND;
END
$function$;

ALTER FUNCTION public.ruwang_arsip_soft_delete_digital_document(text, text)
  OWNER TO ruwang_arsip_policy;
REVOKE ALL ON FUNCTION public.ruwang_arsip_soft_delete_digital_document(text, text)
  FROM PUBLIC;

DO $grant_app$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_app') THEN
    GRANT EXECUTE ON FUNCTION
      public.ruwang_arsip_soft_delete_digital_document(text, text)
      TO ruwang_arsip_app;
  END IF;
END
$grant_app$;
