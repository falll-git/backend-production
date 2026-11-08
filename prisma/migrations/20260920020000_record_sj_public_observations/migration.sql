-- Observation evidence is separate from approval, ingest ACK and aggregate state.
CREATE TABLE public.sj_public_observations (
  id uuid PRIMARY KEY,
  publication_id text REFERENCES public.sj_publications(id) ON DELETE RESTRICT,
  profile_id text REFERENCES public.sj_public_profiles(id) ON DELETE RESTRICT,
  source_origin text NOT NULL,
  public_identity text NOT NULL,
  institution_slug text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','AVAILABLE','NOT_FOUND','FAILED')),
  failure_code text,
  observed_version integer CHECK (observed_version IS NULL),
  CHECK (num_nonnulls(publication_id,profile_id)=1),
  CHECK ((state='PENDING' AND finished_at IS NULL AND failure_code IS NULL)
    OR (state IN ('AVAILABLE','NOT_FOUND') AND finished_at>=started_at AND failure_code IS NULL)
    OR (state='FAILED' AND finished_at>=started_at AND failure_code IS NOT NULL))
);
CREATE INDEX sj_public_observations_publication_idx ON public.sj_public_observations(publication_id,started_at DESC,id DESC);
CREATE INDEX sj_public_observations_profile_idx ON public.sj_public_observations(profile_id,started_at DESC,id DESC);
ALTER TABLE public.sj_public_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_public_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY sj_public_observations_read ON public.sj_public_observations FOR SELECT USING (
  (publication_id IS NOT NULL AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/seputar-jaminan/publikasi'],'read')
    AND public.ruwang_arsip_sj_can_access_publication(publication_id,'read'))
  OR (profile_id IS NOT NULL AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/seputar-jaminan/profil'],'read'))
);
CREATE POLICY sj_public_observations_create ON public.sj_public_observations FOR INSERT WITH CHECK (
  state='PENDING' AND ((publication_id IS NOT NULL
    AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/seputar-jaminan/publikasi'],'update')
    AND public.ruwang_arsip_sj_can_access_publication(publication_id,'update'))
  OR (profile_id IS NOT NULL AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/seputar-jaminan/profil'],'update')))
);
CREATE POLICY sj_public_observations_complete ON public.sj_public_observations FOR UPDATE USING (
  state='PENDING' AND ((publication_id IS NOT NULL
    AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/seputar-jaminan/publikasi'],'update')
    AND public.ruwang_arsip_sj_can_access_publication(publication_id,'update'))
  OR (profile_id IS NOT NULL AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/seputar-jaminan/profil'],'update')))
) WITH CHECK (state IN ('AVAILABLE','NOT_FOUND','FAILED'));
REVOKE ALL ON public.sj_public_observations FROM PUBLIC;
GRANT SELECT,INSERT ON public.sj_public_observations TO ruwang_arsip_app;
GRANT UPDATE(state,finished_at,failure_code) ON public.sj_public_observations TO ruwang_arsip_app;
-- No worker, reviewer, anonymous, DELETE, retention or payload/body grants.
