-- Immutable, actor-bound receipts. No content, credentials or public-state claim.
CREATE TABLE public.sj_save_operations (
  id uuid NOT NULL,
  actor_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('PROFILE','CONTACT','PUBLICATION')),
  request_checksum text NOT NULL CHECK (request_checksum ~ '^[0-9a-f]{64}$'),
  intent text NOT NULL CHECK (intent IN ('SAVE_DRAFT','SAVE_AND_SUBMIT')),
  resource_id text NOT NULL,
  lock_version integer NOT NULL CHECK (lock_version >= 0),
  state text NOT NULL CHECK (state IN ('DRAFT','IN_REVIEW')),
  submission_error text,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_id,id),
  CHECK ((intent='SAVE_DRAFT' AND state='DRAFT' AND submission_error IS NULL)
    OR (intent='SAVE_AND_SUBMIT' AND state='IN_REVIEW' AND submission_error IS NULL)
    OR (intent='SAVE_AND_SUBMIT' AND kind='PUBLICATION' AND state='DRAFT' AND submission_error IS NOT NULL AND length(submission_error)>0))
);
ALTER TABLE public.sj_save_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_save_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY sj_save_operations_read ON public.sj_save_operations FOR SELECT USING (
  actor_id = NULLIF(current_setting('app.current_user_id',true),'')
  AND public.ruwang_arsip_has_menu_permission(ARRAY[CASE kind
    WHEN 'PROFILE' THEN '/dashboard/seputar-jaminan/profil'
    WHEN 'CONTACT' THEN '/dashboard/seputar-jaminan/kontak'
    ELSE '/dashboard/seputar-jaminan/publikasi' END],'read')
  AND (kind <> 'PUBLICATION' OR public.ruwang_arsip_sj_can_access_publication(resource_id,'read'))
);
CREATE POLICY sj_save_operations_insert ON public.sj_save_operations FOR INSERT WITH CHECK (
  actor_id = NULLIF(current_setting('app.current_user_id',true),'')
  AND (public.ruwang_arsip_has_menu_permission(ARRAY[CASE kind
    WHEN 'PROFILE' THEN '/dashboard/seputar-jaminan/profil'
    WHEN 'CONTACT' THEN '/dashboard/seputar-jaminan/kontak'
    ELSE '/dashboard/seputar-jaminan/publikasi' END],'update')
    OR (intent='SAVE_DRAFT' AND kind <> 'PROFILE' AND public.ruwang_arsip_has_menu_permission(ARRAY[CASE kind
      WHEN 'CONTACT' THEN '/dashboard/seputar-jaminan/kontak'
      ELSE '/dashboard/seputar-jaminan/publikasi' END],'create')))
  AND (kind <> 'PUBLICATION' OR public.ruwang_arsip_sj_can_access_publication(resource_id,'read'))
);
REVOKE ALL ON public.sj_save_operations FROM PUBLIC;
GRANT SELECT,INSERT ON public.sj_save_operations TO ruwang_arsip_app;
