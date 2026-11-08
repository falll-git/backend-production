ALTER TABLE public.sj_integration_settings
  ADD COLUMN review_authority varchar(16) NOT NULL DEFAULT 'local',
  ADD CONSTRAINT sj_integration_settings_review_authority CHECK (review_authority IN ('local', 'central'));

ALTER TABLE public.sj_public_profile_versions ADD COLUMN approved_by_subject varchar(220);
ALTER TABLE public.sj_whatsapp_contact_versions ADD COLUMN verified_by_subject varchar(220);
ALTER TABLE public.sj_publication_versions ADD COLUMN approved_by_subject varchar(220);
ALTER TABLE public.sj_publication_reviews
  ALTER COLUMN reviewer_id DROP NOT NULL,
  ADD COLUMN reviewer_subject varchar(220),
  ADD CONSTRAINT sj_publication_reviews_actor_present CHECK ((reviewer_id IS NULL) <> (reviewer_subject IS NULL));

ALTER TABLE public.sj_public_profile_versions
  ADD CONSTRAINT sj_profile_version_approver_present CHECK (state <> 'APPROVED' OR ((approved_by IS NULL) <> (approved_by_subject IS NULL)));
ALTER TABLE public.sj_whatsapp_contact_versions
  ADD CONSTRAINT sj_contact_version_verifier_present CHECK (state <> 'VERIFIED' OR ((verified_by IS NULL) <> (verified_by_subject IS NULL)));
ALTER TABLE public.sj_publication_versions
  ADD CONSTRAINT sj_publication_version_approver_present CHECK (state <> 'APPROVED' OR ((approved_by IS NULL) <> (approved_by_subject IS NULL)));

CREATE TABLE public.sj_control_review_commands (
  command_id uuid PRIMARY KEY,
  instance_id uuid NOT NULL,
  key_id varchar(100) NOT NULL,
  command_digest char(64) NOT NULL CHECK (command_digest ~ '^[a-f0-9]{64}$'),
  actor_subject varchar(220) NOT NULL CHECK (actor_subject ~ '^ruwang-control:'),
  resource_kind varchar(24) NOT NULL CHECK (resource_kind IN ('publication', 'profile', 'contact')),
  resource_id uuid NOT NULL,
  decision varchar(32) NOT NULL CHECK (decision IN ('approve', 'request_revision')),
  expected_version integer NOT NULL CHECK (expected_version >= 0),
  expected_checksum char(64) NOT NULL CHECK (expected_checksum ~ '^[a-f0-9]{64}$'),
  request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
  acknowledgment_json jsonb CHECK (acknowledgment_json IS NULL OR jsonb_typeof(acknowledgment_json) = 'object'),
  status varchar(24) NOT NULL CHECK (status IN ('PROCESSING', 'APPLIED', 'REJECTED')),
  result_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX sj_control_review_commands_instance_time_idx ON public.sj_control_review_commands(instance_id, created_at DESC);
CREATE INDEX sj_control_review_commands_resource_time_idx ON public.sj_control_review_commands(resource_kind, resource_id, created_at DESC);

CREATE TABLE public.sj_control_request_nonces (
  instance_id uuid NOT NULL,
  key_id varchar(100) NOT NULL,
  nonce uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, key_id, nonce),
  CHECK (expires_at > created_at)
);
CREATE INDEX sj_control_request_nonces_expiry_idx ON public.sj_control_request_nonces(expires_at);

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_validate_version_for_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE publication_record public.sj_publications%ROWTYPE; detail_count integer; media_count integer; cover_count integer; media_total bigint;
BEGIN
  IF NEW.state NOT IN ('IN_REVIEW', 'APPROVED') OR NEW.state IS NOT DISTINCT FROM OLD.state THEN RETURN NEW; END IF;
  SELECT * INTO STRICT publication_record FROM public.sj_publications WHERE id = NEW.publication_id;
  IF NEW.submitted_by IS NULL OR NEW.submitted_at IS NULL THEN RAISE EXCEPTION 'Snapshot publikasi wajib memiliki pengaju dan waktu pengajuan'; END IF;
  IF NEW.state = 'APPROVED' AND (NEW.approved_at IS NULL OR ((NEW.approved_by IS NULL) = (NEW.approved_by_subject IS NULL)) OR (NEW.approved_by IS NOT NULL AND (NEW.approved_by = NEW.last_edited_by OR NEW.approved_by = NEW.submitted_by))) THEN RAISE EXCEPTION 'Pemeriksa publikasi harus berbeda dari pembuat/pengaju'; END IF;
  IF public.ruwang_arsip_sj_json_has_denied_key(NEW.public_payload_json) THEN RAISE EXCEPTION 'Payload publik mengandung field yang dilarang'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sj_taxonomy_items item WHERE item.id = NEW.taxonomy_item_id AND item.taxonomy_version = NEW.taxonomy_version AND item.category = publication_record.asset_category AND item.is_active) THEN RAISE EXCEPTION 'Kategori dan taxonomy publikasi tidak konsisten'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sj_whatsapp_contact_versions version JOIN public.sj_whatsapp_contacts contact ON contact.id = version.contact_id WHERE version.id = NEW.whatsapp_contact_version_id AND version.state = 'VERIFIED' AND contact.state = 'VERIFIED' AND contact.revoked_at IS NULL AND contact.current_version_id = version.id) THEN RAISE EXCEPTION 'Kontak WhatsApp belum aktif dan terverifikasi'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sj_public_profile_versions version JOIN public.sj_public_profiles profile ON profile.id = version.profile_id WHERE version.id = NEW.profile_version_id AND version.state = 'APPROVED' AND profile.state = 'VERIFIED' AND profile.current_version_id = version.id) THEN RAISE EXCEPTION 'Profil publik BPRS belum disetujui'; END IF;
  SELECT (SELECT COUNT(*) FROM public.sj_land_details WHERE publication_version_id = NEW.id) + (SELECT COUNT(*) FROM public.sj_building_details WHERE publication_version_id = NEW.id) + (SELECT COUNT(*) FROM public.sj_machine_details WHERE publication_version_id = NEW.id) + (SELECT COUNT(*) FROM public.sj_vehicle_details WHERE publication_version_id = NEW.id) INTO detail_count;
  IF detail_count <> 1 THEN RAISE EXCEPTION 'Snapshot wajib memiliki tepat satu detail kategori'; END IF;
  IF (publication_record.asset_category = 'LAND' AND NOT EXISTS (SELECT 1 FROM public.sj_land_details WHERE publication_version_id = NEW.id)) OR (publication_record.asset_category = 'BUILDING' AND NOT EXISTS (SELECT 1 FROM public.sj_building_details WHERE publication_version_id = NEW.id)) OR (publication_record.asset_category = 'MACHINE_EQUIPMENT' AND NOT EXISTS (SELECT 1 FROM public.sj_machine_details WHERE publication_version_id = NEW.id)) OR (publication_record.asset_category = 'VEHICLE' AND NOT EXISTS (SELECT 1 FROM public.sj_vehicle_details WHERE publication_version_id = NEW.id)) THEN RAISE EXCEPTION 'Detail kategori tidak sesuai dengan publikasi'; END IF;
  SELECT COUNT(*), COUNT(*) FILTER (WHERE link.is_cover), COALESCE(SUM(media.size_bytes), 0) INTO media_count, cover_count, media_total FROM public.sj_publication_version_media link JOIN public.sj_media_assets media ON media.id = link.media_asset_id WHERE link.publication_version_id = NEW.id AND media.owner_division_id = publication_record.owner_division_id AND media.state = 'READY' AND media.central_media_id IS NOT NULL AND media.detected_mime IN ('image/jpeg', 'image/png', 'image/webp') AND media.width BETWEEN 1 AND 2560 AND media.height BETWEEN 1 AND 2560;
  IF media_count NOT BETWEEN 1 AND 10 OR cover_count <> 1 OR media_total > 52428800 THEN RAISE EXCEPTION 'Media publikasi belum memenuhi aturan 1-10 foto, satu sampul, dan maksimum 50 MB'; END IF;
  IF media_count <> (SELECT COUNT(*) FROM public.sj_publication_version_media WHERE publication_version_id = NEW.id) THEN RAISE EXCEPTION 'Semua media harus siap di pusat dan berasal dari divisi pemilik publikasi'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_guard_version_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.state <> 'DRAFT' THEN
    IF OLD.state = 'IN_REVIEW' AND NEW.state = 'APPROVED' THEN
      IF (to_jsonb(NEW) - ARRAY['state','submitted_by','submitted_at','approved_by','approved_by_subject','approved_at','rejection_reason','public_payload_json','payload_checksum']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','submitted_by','submitted_at','approved_by','approved_by_subject','approved_at','rejection_reason','public_payload_json','payload_checksum']) THEN RAISE EXCEPTION 'Isi bisnis snapshot tidak dapat berubah saat persetujuan'; END IF;
    ELSIF (to_jsonb(NEW) - ARRAY['state','submitted_by','submitted_at','approved_by','approved_by_subject','approved_at','rejection_reason']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','submitted_by','submitted_at','approved_by','approved_by_subject','approved_at','rejection_reason']) THEN RAISE EXCEPTION 'Snapshot yang sudah diajukan tidak dapat diubah'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_guard_profile_version_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.state <> 'DRAFT' AND (to_jsonb(NEW) - ARRAY['state','submitted_at','approved_by','approved_by_subject','approved_at','rejection_reason']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','submitted_at','approved_by','approved_by_subject','approved_at','rejection_reason']) THEN RAISE EXCEPTION 'Snapshot profil yang sudah diajukan tidak dapat diubah'; END IF;
  IF NEW.state = 'APPROVED' AND (NEW.approved_at IS NULL OR ((NEW.approved_by IS NULL) = (NEW.approved_by_subject IS NULL)) OR (NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.created_by)) THEN RAISE EXCEPTION 'Pemeriksa profil harus berbeda dari pembuat'; END IF;
  IF public.ruwang_arsip_sj_json_has_denied_key(NEW.payload_json) THEN RAISE EXCEPTION 'Payload profil mengandung field yang dilarang'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_guard_contact_version_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.state <> 'DRAFT' AND (to_jsonb(NEW) - ARRAY['state','submitted_at','verified_by','verified_by_subject','verified_at','rejection_reason']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','submitted_at','verified_by','verified_by_subject','verified_at','rejection_reason']) THEN RAISE EXCEPTION 'Snapshot kontak yang sudah diajukan tidak dapat diubah'; END IF;
  IF NEW.state = 'VERIFIED' AND (NEW.verified_at IS NULL OR ((NEW.verified_by IS NULL) = (NEW.verified_by_subject IS NULL)) OR (NEW.verified_by IS NOT NULL AND NEW.verified_by = NEW.created_by)) THEN RAISE EXCEPTION 'Pemeriksa kontak harus berbeda dari pembuat'; END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON TABLE public.sj_control_review_commands, public.sj_control_request_nonces FROM PUBLIC, ruwang_arsip_app, ruwang_sj_worker;

DO $grant_control_review_system$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_system') THEN
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_json_has_denied_key(jsonb)
      TO ruwang_arsip_system;
  END IF;
END
$grant_control_review_system$;
