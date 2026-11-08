-- Dedicated bank-side receiver for signed Control decisions. No login credential
-- is created here. It must not be granted to the normal API or worker login.
CREATE ROLE ruwang_sj_review NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO ruwang_sj_review;
-- Publication service response includes owning division identity only.
GRANT SELECT (id,name) ON public.divisions TO ruwang_sj_review;

DO $review_scope$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sj_integration_settings','sj_public_profiles','sj_public_profile_versions',
    'sj_whatsapp_contacts','sj_whatsapp_contact_versions','sj_publications',
    'sj_publication_versions','sj_publication_reviews','sj_publication_version_media',
    'sj_land_details','sj_building_details','sj_machine_details','sj_vehicle_details',
    'sj_taxonomy_items','sj_taxonomy_versions','sj_media_assets','sj_sync_outbox',
    'sj_control_change_requests'
  ] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO ruwang_sj_review',table_name);
    EXECUTE format('CREATE POLICY sj_review_read ON public.%I FOR SELECT TO ruwang_sj_review USING (true)',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY[
    'sj_public_profiles','sj_public_profile_versions','sj_whatsapp_contacts',
    'sj_whatsapp_contact_versions','sj_publications','sj_publication_versions',
    'sj_control_change_requests','sj_media_assets'
  ] LOOP
    EXECUTE format('CREATE POLICY sj_review_update ON public.%I FOR UPDATE TO ruwang_sj_review USING (true) WITH CHECK (true)',table_name);
  END LOOP;
END
$review_scope$;
GRANT UPDATE (state,current_version_id,sync_state,aggregate_version,lock_version,updated_at) ON public.sj_public_profiles TO ruwang_sj_review;
GRANT UPDATE (state,approved_by,approved_by_subject,approved_at,rejection_reason) ON public.sj_public_profile_versions TO ruwang_sj_review;
GRANT UPDATE (state,current_version_id,sync_state,aggregate_version,lock_version,last_verified_at,revoked_at,is_default,updated_at) ON public.sj_whatsapp_contacts TO ruwang_sj_review;
GRANT UPDATE (state,verified_by,verified_by_subject,verified_at,rejection_reason) ON public.sj_whatsapp_contact_versions TO ruwang_sj_review;
GRANT UPDATE (state,published_version_id,sync_state,aggregate_version,lock_version,last_confirmed_at,next_reconfirmation_at,last_sync_error_code,updated_at) ON public.sj_publications TO ruwang_sj_review;
GRANT UPDATE (state,approved_by,approved_by_subject,approved_at,rejection_reason,public_payload_json,payload_checksum) ON public.sj_publication_versions TO ruwang_sj_review;
GRANT UPDATE (state,revoked_at,rejection_code,updated_at) ON public.sj_media_assets TO ruwang_sj_review;
GRANT UPDATE ON public.sj_control_change_requests TO ruwang_sj_review;
GRANT INSERT ON public.sj_publication_reviews,public.sj_sync_outbox TO ruwang_sj_review;
CREATE POLICY sj_review_insert ON public.sj_publication_reviews FOR INSERT TO ruwang_sj_review WITH CHECK (true);
CREATE POLICY sj_review_insert ON public.sj_sync_outbox FOR INSERT TO ruwang_sj_review WITH CHECK (true);
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_json_has_denied_key(jsonb) TO ruwang_sj_review;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_is_worker(),
  public.ruwang_arsip_sj_has_global_access(text),
  public.ruwang_arsip_sj_can_access_division(text,text),
  public.ruwang_arsip_sj_can_access_publication(text,text),
  public.ruwang_arsip_sj_can_access_version(text,text) TO ruwang_sj_review;

ALTER TABLE public.sj_control_review_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_control_review_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_control_request_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_control_request_nonces FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.sj_control_review_commands TO ruwang_sj_review;
GRANT SELECT,INSERT,DELETE ON public.sj_control_request_nonces TO ruwang_sj_review;
CREATE POLICY sj_review_ledger ON public.sj_control_review_commands TO ruwang_sj_review USING (true) WITH CHECK (true);
CREATE POLICY sj_review_nonce ON public.sj_control_request_nonces TO ruwang_sj_review USING (true) WITH CHECK (true);

-- Read only the decision outcome for an exact visible submission, not the private
-- signed command/envelope/actor/ACK. Existing policy helper is never a login.
GRANT SELECT ON public.sj_control_review_commands TO ruwang_arsip_policy;
CREATE FUNCTION public.ruwang_arsip_sj_review_outcome(
  kind text, resource text, submitted_version integer, checksum text
) RETURNS TABLE(status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,public
AS $$
  SELECT command.status::text
  FROM public.sj_control_review_commands command
  WHERE public.ruwang_arsip_has_menu_permission(
      ARRAY['/dashboard/seputar-jaminan/pengajuan']::text[], 'read')
    AND CASE WHEN kind = 'publication'
      THEN public.ruwang_arsip_sj_can_access_publication(resource, 'read')
      ELSE kind IN ('profile','contact') AND public.ruwang_arsip_sj_has_global_access('read') END
    AND command.resource_kind = kind AND command.resource_id::text = resource
    AND command.expected_version = submitted_version AND command.expected_checksum = checksum
    AND command.status IN ('APPLIED','REJECTED')
  ORDER BY (command.status = 'APPLIED') DESC, command.processed_at DESC, command.command_id
  LIMIT 1
$$;
ALTER FUNCTION public.ruwang_arsip_sj_review_outcome(text,text,integer,text) OWNER TO ruwang_arsip_policy;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_review_outcome(text,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_review_outcome(text,text,integer,text) TO ruwang_arsip_app;
