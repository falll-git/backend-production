ALTER TYPE public.sj_profile_states ADD VALUE IF NOT EXISTS 'HIDDEN';

CREATE TYPE public.sj_change_request_actions AS ENUM (
  'UNPUBLISH_PUBLICATION',
  'ARCHIVE_PUBLICATION',
  'HIDE_PROFILE',
  'REVOKE_CONTACT',
  'REVOKE_MEDIA',
  'RECONFIRM_PUBLICATION'
);

CREATE TYPE public.sj_change_request_resource_kinds AS ENUM (
  'PUBLICATION', 'PROFILE', 'CONTACT', 'MEDIA'
);

CREATE TYPE public.sj_change_request_states AS ENUM (
  'IN_REVIEW', 'REVISION_REQUIRED', 'REJECTED', 'APPLIED', 'COMPLETED', 'FAILED'
);

CREATE TABLE public.sj_control_change_requests (
  id uuid PRIMARY KEY,
  action public.sj_change_request_actions NOT NULL,
  resource_kind public.sj_change_request_resource_kinds NOT NULL,
  resource_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
  state public.sj_change_request_states NOT NULL DEFAULT 'IN_REVIEW',
  request_version integer NOT NULL DEFAULT 1 CHECK (request_version > 0),
  expected_resource_version integer NOT NULL CHECK (expected_resource_version >= 0),
  expected_resource_checksum char(64) NOT NULL CHECK (expected_resource_checksum ~ '^[a-f0-9]{64}$'),
  impact_json jsonb NOT NULL CHECK (jsonb_typeof(impact_json) = 'object'),
  impact_checksum char(64) NOT NULL CHECK (impact_checksum ~ '^[a-f0-9]{64}$'),
  submitted_by text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewer_note text CHECK (reviewer_note IS NULL OR char_length(btrim(reviewer_note)) BETWEEN 1 AND 2000),
  decided_by_subject varchar(220) CHECK (decided_by_subject IS NULL OR decided_by_subject ~ '^ruwang-control:'),
  decided_at timestamptz,
  applied_at timestamptz,
  completed_at timestamptz,
  sync_event_id uuid UNIQUE,
  failure_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sj_change_request_decision_fields CHECK (
    (state IN ('IN_REVIEW', 'REVISION_REQUIRED') AND decided_by_subject IS NULL AND decided_at IS NULL)
    OR (state IN ('REJECTED', 'APPLIED', 'COMPLETED', 'FAILED') AND decided_by_subject IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT sj_change_request_completion_fields CHECK (
    (state = 'COMPLETED' AND completed_at IS NOT NULL)
    OR (state <> 'COMPLETED' AND completed_at IS NULL)
  )
);

CREATE INDEX sj_control_change_requests_queue_idx
  ON public.sj_control_change_requests(state, created_at);
CREATE INDEX sj_control_change_requests_resource_idx
  ON public.sj_control_change_requests(resource_kind, resource_id, created_at DESC);
CREATE INDEX sj_control_change_requests_submitter_idx
  ON public.sj_control_change_requests(submitted_by, created_at DESC);
CREATE UNIQUE INDEX sj_control_change_requests_one_active_idx
  ON public.sj_control_change_requests(action, resource_kind, resource_id)
  WHERE state IN ('IN_REVIEW', 'REVISION_REQUIRED', 'APPLIED');

ALTER TABLE public.sj_control_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_control_change_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY sj_control_change_requests_read
  ON public.sj_control_change_requests FOR SELECT
  USING (public.ruwang_arsip_sj_has_global_access('read'));
CREATE POLICY sj_control_change_requests_create
  ON public.sj_control_change_requests FOR INSERT
  WITH CHECK (public.ruwang_arsip_sj_has_global_access('update'));
CREATE POLICY sj_control_change_requests_update
  ON public.sj_control_change_requests FOR UPDATE
  USING (public.ruwang_arsip_sj_has_global_access('update'))
  WITH CHECK (public.ruwang_arsip_sj_has_global_access('update'));

DO $grant_sj_change_requests$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.sj_control_change_requests TO ruwang_arsip_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_system') THEN
    GRANT SELECT, INSERT, UPDATE ON public.sj_control_change_requests TO ruwang_arsip_system;
  END IF;
END
$grant_sj_change_requests$;

ALTER TABLE public.sj_control_review_commands
  DROP CONSTRAINT sj_control_review_commands_resource_kind_check,
  ADD CONSTRAINT sj_control_review_commands_resource_kind_check
    CHECK (resource_kind IN ('publication', 'profile', 'contact', 'change_request')),
  DROP CONSTRAINT sj_control_review_commands_decision_check,
  ADD CONSTRAINT sj_control_review_commands_decision_check
    CHECK (decision IN ('approve', 'request_revision', 'reject'));

ALTER TABLE public.sj_sync_outbox
  DROP CONSTRAINT sj_outbox_event_type_v1,
  ADD CONSTRAINT sj_outbox_event_type_v1 CHECK (event_type IN (
    'UPSERT_BPRS_PROFILE',
    'HIDE_BPRS_PROFILE',
    'UPSERT_WHATSAPP_CONTACT',
    'REVOKE_WHATSAPP_CONTACT',
    'UPSERT_PUBLICATION_SNAPSHOT',
    'UNPUBLISH_PUBLICATION',
    'ARCHIVE_PUBLICATION',
    'REVOKE_MEDIA',
    'CONTROL_REVIEW_SNAPSHOT'
  ));
