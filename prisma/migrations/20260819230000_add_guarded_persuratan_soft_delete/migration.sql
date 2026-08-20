CREATE OR REPLACE FUNCTION public.ruwang_arsip_soft_delete_incoming_mail(
  target_id text,
  actor_user_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF actor_user_id IS NULL
     OR actor_user_id <> public.ruwang_arsip_current_user_id()
     OR NOT public.ruwang_arsip_can_manage_incoming_mail(target_id, 'delete') THEN
    RETURN false;
  END IF;

  UPDATE public.incoming_mails
  SET deleted_by = actor_user_id,
      deleted_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = target_id
    AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_soft_delete_outgoing_mail(
  target_id text,
  actor_user_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF actor_user_id IS NULL
     OR actor_user_id <> public.ruwang_arsip_current_user_id()
     OR NOT public.ruwang_arsip_can_manage_outgoing_mail(target_id, 'delete') THEN
    RETURN false;
  END IF;

  UPDATE public.outgoing_mails
  SET status = 'INACTIVE'::public.outgoing_mail_statuses,
      deleted_by = actor_user_id,
      deleted_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = target_id
    AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_soft_delete_memorandum(
  target_id text,
  actor_user_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF actor_user_id IS NULL
     OR actor_user_id <> public.ruwang_arsip_current_user_id()
     OR NOT public.ruwang_arsip_can_manage_memorandum(target_id, 'delete') THEN
    RETURN false;
  END IF;

  UPDATE public.memorandums
  SET deleted_by = actor_user_id,
      deleted_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = target_id
    AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;

ALTER FUNCTION public.ruwang_arsip_soft_delete_incoming_mail(text, text)
  OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_soft_delete_outgoing_mail(text, text)
  OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_soft_delete_memorandum(text, text)
  OWNER TO ruwang_arsip_policy;

REVOKE ALL ON FUNCTION public.ruwang_arsip_soft_delete_incoming_mail(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_soft_delete_outgoing_mail(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_soft_delete_memorandum(text, text)
  FROM PUBLIC;

GRANT UPDATE (deleted_by, deleted_at, updated_at)
  ON public.incoming_mails
  TO ruwang_arsip_policy;
GRANT UPDATE (status, deleted_by, deleted_at, updated_at)
  ON public.outgoing_mails
  TO ruwang_arsip_policy;
GRANT UPDATE (deleted_by, deleted_at, updated_at)
  ON public.memorandums
  TO ruwang_arsip_policy;

DO $grant_app$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_app') THEN
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_soft_delete_incoming_mail(text, text)
      TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_soft_delete_outgoing_mail(text, text)
      TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_soft_delete_memorandum(text, text)
      TO ruwang_arsip_app;
  END IF;
END
$grant_app$;
