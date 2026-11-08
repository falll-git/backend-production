-- Additive guard: shared contacts cannot be revoked while referenced in another
-- division, an older approved version, or an undelivered publication snapshot.
-- Uses the existing non-login policy owner; no privileged runtime membership.
CREATE FUNCTION public.ruwang_arsip_sj_contact_referenced(target_contact text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT (pg_has_role(session_user, 'ruwang_sj_review', 'member')
    OR public.ruwang_arsip_has_menu_permission(
      ARRAY['/dashboard/seputar-jaminan/kontak']::text[], 'update')
    OR (public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/seputar-jaminan/pengajuan']::text[], 'update')
      AND public.ruwang_arsip_has_menu_feature(ARRAY['/dashboard/seputar-jaminan/pengajuan']::text[], 'sj_contact_verify'))) THEN
    RAISE EXCEPTION 'Contact reference check not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.sj_publications p
    JOIN public.sj_publication_versions v ON v.id IN (p.current_version_id,p.published_version_id)
    JOIN public.sj_whatsapp_contact_versions c ON c.id=v.whatsapp_contact_version_id
    WHERE c.contact_id=target_contact AND p.state <> 'ARCHIVED'
  ) OR EXISTS (
    SELECT 1 FROM public.sj_sync_outbox e
    WHERE e.aggregate_type='PUBLICATION' AND e.event_type='UPSERT_PUBLICATION_SNAPSHOT'
      AND e.payload_json->>'whatsapp_contact_id'=target_contact
      AND (e.state <> 'ACKNOWLEDGED' OR NOT EXISTS (
        SELECT 1 FROM public.sj_sync_outbox newer
        WHERE newer.aggregate_type='PUBLICATION' AND newer.aggregate_id=e.aggregate_id
          AND newer.aggregate_version>e.aggregate_version AND newer.state='ACKNOWLEDGED'
          AND newer.event_type IN ('UPSERT_PUBLICATION_SNAPSHOT','UNPUBLISH_PUBLICATION','ARCHIVE_PUBLICATION')
      ))
  );
END $$;
ALTER FUNCTION public.ruwang_arsip_sj_contact_referenced(text) OWNER TO ruwang_arsip_policy;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_contact_referenced(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_contact_referenced(text) TO ruwang_arsip_app,ruwang_sj_review;

-- Statement locks precede row locks. The same lock is acquired by application
-- workflow entry points before reading prerequisites. VOLATILE trigger queries
-- recheck after waiting, rather than relying on an earlier RLS-limited count.
CREATE FUNCTION public.ruwang_arsip_sj_lock_contact_references()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ruwang:sj:contact-references'));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_lock_contact_references() FROM PUBLIC;
CREATE TRIGGER sj_contact_reference_statement_lock BEFORE INSERT OR UPDATE ON public.sj_publication_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.ruwang_arsip_sj_lock_contact_references();
CREATE TRIGGER sj_contact_reference_statement_lock BEFORE INSERT OR UPDATE ON public.sj_publications
  FOR EACH STATEMENT EXECUTE FUNCTION public.ruwang_arsip_sj_lock_contact_references();
CREATE TRIGGER sj_contact_reference_statement_lock BEFORE UPDATE ON public.sj_whatsapp_contacts
  FOR EACH STATEMENT EXECUTE FUNCTION public.ruwang_arsip_sj_lock_contact_references();

CREATE FUNCTION public.ruwang_arsip_sj_guard_contact_revoke()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF (NEW.state='REVOKED' OR NEW.revoked_at IS NOT NULL)
    AND OLD.revoked_at IS NULL AND OLD.state <> 'REVOKED'
    AND public.ruwang_arsip_sj_contact_referenced(NEW.id) THEN
    RAISE EXCEPTION 'Kontak masih dipakai publikasi atau pengiriman belum selesai.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.ruwang_arsip_sj_guard_contact_revoke() OWNER TO ruwang_arsip_policy;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_guard_contact_revoke() FROM PUBLIC;
CREATE TRIGGER sj_contact_revoke_reference_guard BEFORE UPDATE ON public.sj_whatsapp_contacts
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_contact_revoke();

CREATE FUNCTION public.ruwang_arsip_sj_guard_contact_reference_target()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.whatsapp_contact_version_id IS DISTINCT FROM OLD.whatsapp_contact_version_id
     OR (NEW.state IN ('IN_REVIEW','APPROVED') AND NEW.state IS DISTINCT FROM OLD.state) THEN
    IF NOT EXISTS (SELECT 1 FROM public.sj_whatsapp_contact_versions v
      JOIN public.sj_whatsapp_contacts c ON c.id=v.contact_id
      WHERE v.id=NEW.whatsapp_contact_version_id AND c.revoked_at IS NULL AND c.state <> 'REVOKED') THEN
      RAISE EXCEPTION 'Kontak sudah dicabut. Pilih kontak aktif sebelum melanjutkan.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.ruwang_arsip_sj_guard_contact_reference_target() OWNER TO ruwang_arsip_policy;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_guard_contact_reference_target() FROM PUBLIC;
CREATE TRIGGER sj_contact_reference_target_guard BEFORE INSERT OR UPDATE ON public.sj_publication_versions
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_contact_reference_target();
