-- Signed Control recovery is delivery-only. No existing row is rewritten.
CREATE TABLE public.sj_control_recovery_receipts (
  request_id uuid PRIMARY KEY,
  instance_id uuid NOT NULL,
  operator_id uuid NOT NULL,
  job_id text NOT NULL REFERENCES public.sj_sync_outbox(id) ON DELETE RESTRICT,
  request_digest char(64) NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  reason varchar(500) NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500),
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.sj_control_recovery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_control_recovery_receipts FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.sj_control_recovery_receipts TO ruwang_sj_review;
CREATE POLICY sj_recovery_receipt_scope ON public.sj_control_recovery_receipts TO ruwang_sj_review
  USING (EXISTS(SELECT 1 FROM public.sj_integration_settings s
    WHERE s.installation_id::text=instance_id::text AND s.review_authority='central' AND s.review_enabled))
  WITH CHECK (EXISTS(SELECT 1 FROM public.sj_integration_settings s
    WHERE s.installation_id::text=instance_id::text AND s.review_authority='central' AND s.review_enabled));

-- Review runtime remains non-owner and cannot modify event identity/payload,
-- attempt history, acknowledgment or counters. Requeue is the only new grant.
GRANT UPDATE (state,available_at,last_error_code,locked_at,locked_by)
  ON public.sj_sync_outbox TO ruwang_sj_review;
CREATE POLICY sj_review_delivery_retry ON public.sj_sync_outbox FOR UPDATE TO ruwang_sj_review
  USING (state IN ('FAILED','QUARANTINED','RETRYING') AND locked_at IS NULL AND locked_by IS NULL
    AND EXISTS(SELECT 1 FROM public.sj_integration_settings s
      WHERE target_binding_json->>'installation_id'=s.installation_id::text
        AND s.review_authority='central' AND s.review_enabled))
  WITH CHECK (state='QUEUED' AND locked_at IS NULL AND locked_by IS NULL
    AND EXISTS(SELECT 1 FROM public.sj_integration_settings s
      WHERE target_binding_json->>'installation_id'=s.installation_id::text
        AND s.review_authority='central' AND s.review_enabled));
