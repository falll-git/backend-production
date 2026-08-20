CREATE OR REPLACE FUNCTION public.ruwang_arsip_sync_incoming_mail_workflow_status(
  target_id text,
  actor_user_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  next_status text;
BEGIN
  IF actor_user_id IS NULL
     OR actor_user_id <> public.ruwang_arsip_current_user_id()
     OR NOT public.ruwang_arsip_has_menu_permission(
       ARRAY['/dashboard/manajemen-surat/kelola-surat/input-surat-masuk']::text[],
       'update'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.incoming_mail_dispositions disposition
       WHERE disposition.incoming_mails_id = target_id
         AND actor_user_id IN (disposition.sender_id, disposition.receiver_id)
     ) THEN
    RETURN false;
  END IF;

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM public.incoming_mail_dispositions disposition
      WHERE disposition.incoming_mails_id = target_id
        AND disposition.status IN ('NEW', 'IN_PROGRESS')
    ) THEN 'COMPLETED'
    WHEN EXISTS (
      SELECT 1
      FROM public.incoming_mail_dispositions disposition
      WHERE disposition.incoming_mails_id = target_id
        AND disposition.status IN ('NEW', 'IN_PROGRESS')
        AND disposition.due_date IS NOT NULL
        AND disposition.due_date < CURRENT_TIMESTAMP
    ) THEN 'OVERDUE'
    ELSE 'IN_PROGRESS'
  END
  INTO next_status;

  UPDATE public.incoming_mails
  SET status = next_status::public.mail_workflow_statuses,
      updated_by = actor_user_id,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = target_id
    AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sync_memorandum_workflow_status(
  target_id text,
  actor_user_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  next_status text;
BEGIN
  IF actor_user_id IS NULL
     OR actor_user_id <> public.ruwang_arsip_current_user_id()
     OR NOT public.ruwang_arsip_has_menu_permission(
       ARRAY['/dashboard/manajemen-surat/kelola-surat/input-memorandum']::text[],
       'update'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.memorandum_dispositions disposition
       WHERE disposition.memorandums_id = target_id
         AND actor_user_id IN (disposition.sender_id, disposition.receiver_id)
     ) THEN
    RETURN false;
  END IF;

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM public.memorandum_dispositions disposition
      WHERE disposition.memorandums_id = target_id
        AND disposition.status IN ('NEW', 'IN_PROGRESS')
    ) THEN 'COMPLETED'
    WHEN EXISTS (
      SELECT 1
      FROM public.memorandum_dispositions disposition
      WHERE disposition.memorandums_id = target_id
        AND disposition.status IN ('NEW', 'IN_PROGRESS')
        AND disposition.due_date IS NOT NULL
        AND disposition.due_date < CURRENT_TIMESTAMP
    ) THEN 'OVERDUE'
    ELSE 'IN_PROGRESS'
  END
  INTO next_status;

  UPDATE public.memorandums
  SET status = next_status::public.mail_workflow_statuses,
      updated_by = actor_user_id,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = target_id
    AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;

ALTER FUNCTION public.ruwang_arsip_sync_incoming_mail_workflow_status(text, text)
  OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_sync_memorandum_workflow_status(text, text)
  OWNER TO ruwang_arsip_policy;

REVOKE ALL ON FUNCTION public.ruwang_arsip_sync_incoming_mail_workflow_status(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sync_memorandum_workflow_status(text, text)
  FROM PUBLIC;

DO $grant_app$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_app') THEN
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sync_incoming_mail_workflow_status(text, text)
      TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sync_memorandum_workflow_status(text, text)
      TO ruwang_arsip_app;
  END IF;
END
$grant_app$;
