-- Additive: old facts remain unknown; never backfill from the bank's mutable draft.
ALTER TABLE public.sj_public_observations
  DROP CONSTRAINT sj_public_observations_observed_version_check,
  ADD COLUMN profile_snapshot jsonb,
  ADD CONSTRAINT sj_public_observation_snapshot_check CHECK (
    (profile_snapshot IS NULL AND observed_version IS NULL)
    OR (profile_id IS NOT NULL AND state='AVAILABLE' AND profile_snapshot IS NOT NULL
      AND jsonb_typeof(profile_snapshot)='object'
      AND (observed_version IS NULL OR observed_version>0))
  );
GRANT UPDATE(observed_version,profile_snapshot) ON public.sj_public_observations TO ruwang_arsip_app;
-- Existing FORCE RLS permits completion of PENDING only. No new delete or worker access.
