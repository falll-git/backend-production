-- Existing events deliberately remain unbound. Their original destination cannot
-- be inferred from today's configuration. No business state or payload is reset.
ALTER TABLE public.sj_sync_outbox ADD COLUMN target_binding_json jsonb;
ALTER TABLE public.sj_sync_outbox ADD CONSTRAINT sj_outbox_target_shape CHECK (
  target_binding_json IS NULL OR (
    jsonb_typeof(target_binding_json) = 'object'
    AND target_binding_json->>'version' = '1'
    AND target_binding_json->>'destination' IN ('CONTROL_REVIEW','SJ_INGEST')
    AND target_binding_json ?& ARRAY['institution_id','installation_id','base_url','signing_key_id','signing_key_fingerprint']
  )
);

CREATE FUNCTION public.sj_guard_outbox_immutable_delivery() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,public AS $$
BEGIN
  IF ROW(NEW.event_id,NEW.aggregate_type,NEW.aggregate_id,NEW.aggregate_version,
         NEW.event_type,NEW.schema_version,NEW.payload_json,NEW.payload_checksum,
         NEW.created_at,NEW.target_binding_json)
     IS DISTINCT FROM
     ROW(OLD.event_id,OLD.aggregate_type,OLD.aggregate_id,OLD.aggregate_version,
         OLD.event_type,OLD.schema_version,OLD.payload_json,OLD.payload_checksum,
         OLD.created_at,OLD.target_binding_json) THEN
    RAISE EXCEPTION 'SJ_OUTBOX_IMMUTABLE_DELIVERY' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sj_outbox_immutable_delivery BEFORE UPDATE ON public.sj_sync_outbox
FOR EACH ROW EXECUTE FUNCTION public.sj_guard_outbox_immutable_delivery();
REVOKE ALL ON FUNCTION public.sj_guard_outbox_immutable_delivery() FROM PUBLIC;
