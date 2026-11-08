-- Additive protection for approved media while a newer draft is being edited.
-- The boolean reveals no cross-division resource identity or count.
CREATE FUNCTION public.ruwang_arsip_sj_media_referenced(target_media text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE central_id text;
BEGIN
  IF NOT (pg_has_role(session_user,'ruwang_sj_review','member') OR EXISTS (
    SELECT 1 FROM public.sj_media_assets m WHERE m.id=target_media
      AND public.ruwang_arsip_sj_can_access_division(m.owner_division_id,'update')
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY['/dashboard/seputar-jaminan/profil','/dashboard/seputar-jaminan/publikasi']::text[],'update')
  )) THEN
    RAISE EXCEPTION 'Media reference check not permitted' USING ERRCODE='42501';
  END IF;
  SELECT central_media_id INTO central_id FROM public.sj_media_assets WHERE id=target_media;
  RETURN EXISTS (
    SELECT 1 FROM public.sj_publications p
    JOIN public.sj_publication_version_media m ON m.publication_version_id IN (p.current_version_id,p.published_version_id)
    WHERE m.media_asset_id=target_media AND p.state<>'ARCHIVED'
  ) OR EXISTS (
    SELECT 1 FROM public.sj_public_profiles p
    LEFT JOIN public.sj_public_profile_versions v ON v.id=p.current_version_id
    WHERE p.state<>'HIDDEN' AND (p.logo_media_id=target_media
      OR v.payload_json->>'logo_media_id'=target_media
      OR (central_id IS NOT NULL AND v.payload_json->>'public_mark'=central_id))
  ) OR EXISTS (
    SELECT 1 FROM public.sj_sync_outbox e
    WHERE central_id IS NOT NULL AND (
      (e.event_type='UPSERT_PUBLICATION_SNAPSHOT' AND e.aggregate_type='PUBLICATION'
        AND e.payload_json->'media' @> jsonb_build_array(jsonb_build_object('media_id',central_id)))
      OR (e.event_type='UPSERT_BPRS_PROFILE' AND e.aggregate_type='BPRS_PROFILE'
        AND e.payload_json->>'public_mark'=central_id)
    ) AND (e.state<>'ACKNOWLEDGED' OR NOT EXISTS (
      SELECT 1 FROM public.sj_sync_outbox newer WHERE newer.aggregate_type=e.aggregate_type
        AND newer.aggregate_id=e.aggregate_id AND newer.aggregate_version>e.aggregate_version
        AND newer.state='ACKNOWLEDGED' AND newer.event_type IN
          ('UPSERT_PUBLICATION_SNAPSHOT','UNPUBLISH_PUBLICATION','ARCHIVE_PUBLICATION','UPSERT_BPRS_PROFILE','HIDE_BPRS_PROFILE')
    ))
  );
END $$;
ALTER FUNCTION public.ruwang_arsip_sj_media_referenced(text) OWNER TO ruwang_arsip_policy;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_media_referenced(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_media_referenced(text) TO ruwang_arsip_app,ruwang_sj_review;

-- Reuse the existing workflow dependency lock so contact and media operations
-- cannot acquire two global locks in opposite orders. No network IO under it.
CREATE TRIGGER sj_media_reference_statement_lock BEFORE INSERT OR UPDATE ON public.sj_publication_version_media
  FOR EACH STATEMENT EXECUTE FUNCTION public.ruwang_arsip_sj_lock_contact_references();
CREATE TRIGGER sj_media_reference_statement_lock BEFORE INSERT OR UPDATE ON public.sj_public_profiles
  FOR EACH STATEMENT EXECUTE FUNCTION public.ruwang_arsip_sj_lock_contact_references();
CREATE TRIGGER sj_media_reference_statement_lock BEFORE UPDATE ON public.sj_media_assets
  FOR EACH STATEMENT EXECUTE FUNCTION public.ruwang_arsip_sj_lock_contact_references();
CREATE TRIGGER sj_media_reference_statement_lock BEFORE INSERT ON public.sj_sync_outbox
  FOR EACH STATEMENT EXECUTE FUNCTION public.ruwang_arsip_sj_lock_contact_references();

CREATE FUNCTION public.ruwang_arsip_sj_guard_media_revoke()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF (NEW.state IN ('REVOKED','DELETED') OR NEW.revoked_at IS NOT NULL)
    AND OLD.revoked_at IS NULL AND OLD.state NOT IN ('REVOKED','DELETED')
    AND public.ruwang_arsip_sj_media_referenced(NEW.id) THEN
    RAISE EXCEPTION 'Gambar masih dipakai atau pengirimannya belum selesai.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.ruwang_arsip_sj_guard_media_revoke() OWNER TO ruwang_arsip_policy;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_guard_media_revoke() FROM PUBLIC;
CREATE TRIGGER sj_media_revoke_guard BEFORE UPDATE ON public.sj_media_assets
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_media_revoke();

CREATE FUNCTION public.ruwang_arsip_sj_guard_media_reference_target()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target_media text;
BEGIN
  IF TG_TABLE_NAME='sj_publication_version_media' THEN target_media=NEW.media_asset_id;
  ELSE target_media=NEW.logo_media_id;
  END IF;
  IF target_media IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sj_media_assets m
    WHERE m.id=target_media AND m.revoked_at IS NULL AND m.state NOT IN ('REVOKED','DELETED')) THEN
    RAISE EXCEPTION 'Gambar sudah dicabut. Pilih gambar aktif.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.ruwang_arsip_sj_guard_media_reference_target() OWNER TO ruwang_arsip_policy;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_guard_media_reference_target() FROM PUBLIC;
CREATE TRIGGER sj_media_reference_target_guard BEFORE INSERT OR UPDATE ON public.sj_publication_version_media
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_media_reference_target();

-- Profile versions carry the logo inside payload_json. The profile row is the
-- actual reference target, and the JSON payload is checked by the revoke
-- function above; no trigger reads a nonexistent version column.
CREATE FUNCTION public.ruwang_arsip_sj_guard_profile_media_target()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.logo_media_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sj_media_assets m
    WHERE m.id=NEW.logo_media_id AND m.revoked_at IS NULL AND m.state NOT IN ('REVOKED','DELETED')) THEN
    RAISE EXCEPTION 'Logo sudah dicabut. Pilih logo aktif.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.ruwang_arsip_sj_guard_profile_media_target() OWNER TO ruwang_arsip_policy;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_guard_profile_media_target() FROM PUBLIC;
CREATE TRIGGER sj_profile_media_target_guard BEFORE INSERT OR UPDATE ON public.sj_public_profiles
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_profile_media_target();
