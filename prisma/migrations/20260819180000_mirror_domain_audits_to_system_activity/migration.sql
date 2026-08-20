-- Domain audits stay in the same business transaction. A narrowly owned
-- trigger mirrors them into the central activity centre, so the application
-- role never receives direct write access to system_activity_logs.
GRANT INSERT ON public.system_activity_logs TO ruwang_arsip_policy;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_mirror_domain_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  row_data jsonb := to_jsonb(NEW);
  activity_module text;
  activity_entity_type text;
  activity_entity_id text;
  activity_title text;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'debtor_activity_logs' THEN
      activity_module := 'INFORMASI_DEBITUR';
      activity_entity_type := row_data->>'entity_type';
      activity_entity_id := row_data->>'entity_id';
    WHEN 'legal_activity_logs' THEN
      activity_module := 'MANAJEMEN_LEGAL';
      activity_entity_type := row_data->>'entity_type';
      activity_entity_id := row_data->>'entity_id';
    WHEN 'storage_activity_logs' THEN
      activity_module := 'ARSIP_DIGITAL';
      activity_entity_type := 'DOKUMEN_DIGITAL';
      activity_entity_id := row_data->>'document_id';
    ELSE
      RAISE EXCEPTION 'Tabel audit domain tidak didukung: %', TG_TABLE_NAME;
  END CASE;

  activity_title := COALESCE(
    NULLIF(row_data->>'title', ''),
    NULLIF(row_data->>'description', ''),
    concat_ws(' ', row_data->>'action', activity_entity_type)
  );

  INSERT INTO public.system_activity_logs (
    actor_id,
    module,
    action,
    source,
    entity_type,
    entity_id,
    object_label,
    title,
    summary,
    request_method,
    request_path,
    request_id,
    before_data,
    after_data,
    metadata,
    user_agent,
    created_at
  ) VALUES (
    NULLIF(row_data->>'actor_id', ''),
    activity_module,
    row_data->>'action',
    COALESCE(NULLIF(row_data->>'source', ''), 'MANUAL'),
    activity_entity_type,
    activity_entity_id,
    COALESCE(activity_title, activity_entity_id),
    COALESCE(activity_title, 'Aktivitas sistem'),
    activity_title,
    NULLIF(current_setting('app.request_method', true), ''),
    NULLIF(current_setting('app.request_path', true), ''),
    NULLIF(current_setting('app.request_id', true), ''),
    row_data->'before_data',
    row_data->'after_data',
    CASE
      WHEN TG_TABLE_NAME = 'storage_activity_logs' THEN jsonb_strip_nulls(
        jsonb_build_object(
          'reference_type', row_data->>'reference_type',
          'reference_id', row_data->>'reference_id',
          'from_storage_id', row_data->>'from_storage_id',
          'to_storage_id', row_data->>'to_storage_id'
        )
      )
      ELSE row_data->'metadata'
    END,
    COALESCE(
      NULLIF(row_data->>'user_agent', ''),
      NULLIF(current_setting('app.user_agent', true), '')
    ),
    COALESCE((row_data->>'created_at')::timestamptz, CURRENT_TIMESTAMP)
  );

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.ruwang_arsip_mirror_domain_activity()
  OWNER TO ruwang_arsip_policy;
REVOKE ALL ON FUNCTION public.ruwang_arsip_mirror_domain_activity() FROM PUBLIC;

DROP TRIGGER IF EXISTS debtor_activity_logs_system_mirror
  ON public.debtor_activity_logs;
CREATE TRIGGER debtor_activity_logs_system_mirror
AFTER INSERT ON public.debtor_activity_logs
FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_mirror_domain_activity();

DROP TRIGGER IF EXISTS legal_activity_logs_system_mirror
  ON public.legal_activity_logs;
CREATE TRIGGER legal_activity_logs_system_mirror
AFTER INSERT ON public.legal_activity_logs
FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_mirror_domain_activity();

DROP TRIGGER IF EXISTS storage_activity_logs_system_mirror
  ON public.storage_activity_logs;
CREATE TRIGGER storage_activity_logs_system_mirror
AFTER INSERT ON public.storage_activity_logs
FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_mirror_domain_activity();
