-- Additive, no backfill from drafts; each snapshot is a fact at check time only.
ALTER TABLE public.sj_public_observations
  ADD COLUMN publication_snapshot jsonb,
  DROP CONSTRAINT sj_public_observation_snapshot_check,
  ADD CONSTRAINT sj_public_observation_snapshot_check CHECK (
    (profile_snapshot IS NULL AND publication_snapshot IS NULL AND observed_version IS NULL)
    OR (profile_id IS NOT NULL AND state='AVAILABLE' AND profile_snapshot IS NOT NULL
      AND jsonb_typeof(profile_snapshot)='object' AND publication_snapshot IS NULL
      AND (observed_version IS NULL OR observed_version>0))
    OR (publication_id IS NOT NULL AND state='AVAILABLE' AND publication_snapshot IS NOT NULL
      AND jsonb_typeof(publication_snapshot)='object' AND profile_snapshot IS NULL
      AND (observed_version IS NULL OR observed_version>0))
  );
GRANT UPDATE(publication_snapshot) ON public.sj_public_observations TO ruwang_arsip_app;
