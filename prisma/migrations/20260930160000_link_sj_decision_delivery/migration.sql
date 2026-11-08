-- Explicit transaction lineage. Never infer an approval from timestamps,
-- consecutive versions or the latest command after an event already exists.
ALTER TABLE public.sj_sync_outbox ADD COLUMN source_command_id uuid;
ALTER TABLE public.sj_sync_outbox ADD CONSTRAINT sj_outbox_source_command_fk
  FOREIGN KEY(source_command_id) REFERENCES public.sj_control_review_commands(command_id) ON DELETE RESTRICT;
CREATE INDEX sj_outbox_source_command_idx ON public.sj_sync_outbox(source_command_id);

CREATE FUNCTION public.sj_capture_decision_delivery() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE decision_command uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.source_command_id IS DISTINCT FROM OLD.source_command_id THEN
      RAISE EXCEPTION 'SJ_OUTBOX_IMMUTABLE_LINEAGE' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  decision_command := nullif(current_setting('app.sj_decision_command_id',true),'')::uuid;
  IF decision_command IS NULL THEN
    IF NEW.source_command_id IS NOT NULL THEN
      RAISE EXCEPTION 'SJ_OUTBOX_LINEAGE_CONTEXT_REQUIRED' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT pg_has_role(current_user,'ruwang_sj_review','member') THEN
    RAISE EXCEPTION 'SJ_OUTBOX_LINEAGE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sj_control_review_commands c
    WHERE c.command_id=decision_command AND c.status='PROCESSING' AND c.decision='approve'
      AND c.instance_id::text=NEW.target_binding_json->>'installation_id') THEN
    RAISE EXCEPTION 'SJ_OUTBOX_LINEAGE_COMMAND_INVALID' USING ERRCODE='23514';
  END IF;
  NEW.source_command_id := decision_command;
  RETURN NEW;
END $$;
CREATE TRIGGER sj_outbox_decision_lineage BEFORE INSERT OR UPDATE ON public.sj_sync_outbox
FOR EACH ROW EXECUTE FUNCTION public.sj_capture_decision_delivery();
REVOKE ALL ON FUNCTION public.sj_capture_decision_delivery() FROM PUBLIC;
