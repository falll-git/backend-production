-- Security and business invariants for the Seputar Jaminan integration.
-- The application role and dedicated worker group must be provisioned before
-- this migration runs. Both roles are deliberately NOLOGIN/NOBYPASSRLS groups.

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_app') THEN
    RAISE EXCEPTION 'Role ruwang_arsip_app belum diprovisikan';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_sj_worker') THEN
    RAISE EXCEPTION 'Role ruwang_sj_worker belum diprovisikan';
  END IF;
END
$roles$;

ALTER TABLE public.sj_publications
  ADD CONSTRAINT sj_publications_reference_format
    CHECK (public_reference_code ~ '^SJ-[A-Z0-9]{8}$'),
  ADD CONSTRAINT sj_publications_source_consistency
    CHECK (
      (source_type = 'COLLATERAL' AND source_collateral_id IS NOT NULL AND manual_reason IS NULL AND manual_evidence_document_id IS NULL)
      OR
      (source_type = 'MANUAL' AND source_collateral_id IS NULL AND NULLIF(BTRIM(manual_reason), '') IS NOT NULL AND NULLIF(BTRIM(manual_evidence_document_id), '') IS NOT NULL)
    ),
  ADD CONSTRAINT sj_publications_versions_nonnegative
    CHECK (aggregate_version >= 0),
  ADD CONSTRAINT sj_publications_lock_version_nonnegative
    CHECK (lock_version >= 0),
  ADD CONSTRAINT sj_publications_reconfirmation_exact
    CHECK (
      (last_confirmed_at IS NULL AND next_reconfirmation_at IS NULL)
      OR next_reconfirmation_at = last_confirmed_at + INTERVAL '30 days'
    ),
  ADD CONSTRAINT sj_publications_published_dates_present
    CHECK (state <> 'PUBLISHED' OR (last_confirmed_at IS NOT NULL AND next_reconfirmation_at IS NOT NULL));

CREATE UNIQUE INDEX sj_publications_one_active_collateral
  ON public.sj_publications(source_collateral_id)
  WHERE source_collateral_id IS NOT NULL AND archived_at IS NULL;

ALTER TABLE public.sj_publication_versions
  ADD CONSTRAINT sj_publication_versions_text_present
    CHECK (
      CHAR_LENGTH(BTRIM(title)) BETWEEN 5 AND 160
      AND CHAR_LENGTH(BTRIM(description)) BETWEEN 20 AND 5000
      AND CHAR_LENGTH(BTRIM(city_regency)) BETWEEN 2 AND 120
      AND CHAR_LENGTH(BTRIM(province)) BETWEEN 2 AND 120
    ),
  ADD CONSTRAINT sj_publication_versions_checksum_format
    CHECK (payload_checksum ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT sj_publication_versions_taxonomy_positive
    CHECK (taxonomy_version > 0),
  ADD CONSTRAINT sj_publication_versions_number_positive
    CHECK (version_number > 0),
  ADD CONSTRAINT sj_publication_versions_available_only
    CHECK (availability = 'AVAILABLE'),
  ADD CONSTRAINT sj_publication_versions_payload_object
    CHECK (jsonb_typeof(public_payload_json) = 'object');

ALTER TABLE public.sj_public_profile_versions
  ADD CONSTRAINT sj_profile_versions_number_positive CHECK (version_number > 0),
  ADD CONSTRAINT sj_profile_versions_checksum_format CHECK (payload_checksum ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT sj_profile_versions_payload_object CHECK (jsonb_typeof(payload_json) = 'object');

ALTER TABLE public.sj_whatsapp_contacts
  ADD CONSTRAINT sj_contacts_e164 CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT sj_contacts_normalized CHECK (phone_normalized ~ '^[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT sj_contacts_phone_match CHECK (phone_normalized = SUBSTRING(phone_e164 FROM 2)),
  ADD CONSTRAINT sj_contacts_label_present CHECK (CHAR_LENGTH(BTRIM(label)) BETWEEN 2 AND 80),
  ADD CONSTRAINT sj_contacts_version_nonnegative CHECK (aggregate_version >= 0),
  ADD CONSTRAINT sj_contacts_lock_version_nonnegative CHECK (lock_version >= 0);

CREATE UNIQUE INDEX sj_whatsapp_contacts_one_default
  ON public.sj_whatsapp_contacts(is_default)
  WHERE is_default AND revoked_at IS NULL;

ALTER TABLE public.sj_whatsapp_contact_versions
  ADD CONSTRAINT sj_contact_versions_number_positive CHECK (version_number > 0),
  ADD CONSTRAINT sj_contact_versions_e164 CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT sj_contact_versions_template_v1 CHECK (message_template_version = 1),
  ADD CONSTRAINT sj_contact_versions_checksum_format CHECK (checksum ~ '^[0-9a-f]{64}$');

ALTER TABLE public.sj_public_profiles
  ADD CONSTRAINT sj_profiles_slug_format CHECK (public_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  ADD CONSTRAINT sj_profiles_text_present CHECK (
    CHAR_LENGTH(BTRIM(display_name)) BETWEEN 3 AND 160
    AND CHAR_LENGTH(BTRIM(city_regency)) BETWEEN 2 AND 120
    AND CHAR_LENGTH(BTRIM(province)) BETWEEN 2 AND 120
    AND CHAR_LENGTH(BTRIM(short_description)) BETWEEN 20 AND 500
  ),
  ADD CONSTRAINT sj_profiles_https_website CHECK (website_url IS NULL OR website_url ~ '^https://'),
  ADD CONSTRAINT sj_profiles_version_nonnegative CHECK (aggregate_version >= 0),
  ADD CONSTRAINT sj_profiles_lock_version_nonnegative CHECK (lock_version >= 0);

ALTER TABLE public.sj_land_details
  ADD CONSTRAINT sj_land_area_positive CHECK (land_area_m2 > 0);

ALTER TABLE public.sj_building_details
  ADD CONSTRAINT sj_building_area_positive CHECK (building_area_m2 > 0),
  ADD CONSTRAINT sj_building_land_area_positive CHECK (land_area_m2 IS NULL OR land_area_m2 > 0),
  ADD CONSTRAINT sj_building_floor_count_positive CHECK (floor_count IS NULL OR floor_count BETWEEN 1 AND 200);

ALTER TABLE public.sj_machine_details
  ADD CONSTRAINT sj_machine_model_present CHECK (NULLIF(BTRIM(model_or_type), '') IS NOT NULL),
  ADD CONSTRAINT sj_machine_condition_present CHECK (NULLIF(BTRIM(public_condition), '') IS NOT NULL),
  ADD CONSTRAINT sj_machine_year_reasonable CHECK (manufacture_year IS NULL OR manufacture_year BETWEEN 1900 AND 2200);

ALTER TABLE public.sj_vehicle_details
  ADD CONSTRAINT sj_vehicle_brand_present CHECK (NULLIF(BTRIM(brand), '') IS NOT NULL),
  ADD CONSTRAINT sj_vehicle_model_present CHECK (NULLIF(BTRIM(model_or_type), '') IS NOT NULL),
  ADD CONSTRAINT sj_vehicle_condition_present CHECK (NULLIF(BTRIM(public_condition), '') IS NOT NULL),
  ADD CONSTRAINT sj_vehicle_year_reasonable CHECK (manufacture_year IS NULL OR manufacture_year BETWEEN 1900 AND 2200),
  ADD CONSTRAINT sj_vehicle_mileage_nonnegative CHECK (mileage_km IS NULL OR mileage_km >= 0);

ALTER TABLE public.sj_media_assets
  ADD CONSTRAINT sj_media_purpose_allowed CHECK (purpose IN ('PUBLICATION_IMAGE', 'BPRS_PUBLIC_MARK')),
  ADD CONSTRAINT sj_media_key_safe CHECK (
    char_length(logical_object_key) BETWEEN 1 AND 512
    AND logical_object_key ~ '^[A-Za-z0-9][A-Za-z0-9/_\.-]*$'
    AND logical_object_key !~ '(^|/)\.\.(/|$)'
  ),
  ADD CONSTRAINT sj_media_mime_allowed CHECK (detected_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT sj_media_size_allowed CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  ADD CONSTRAINT sj_media_dimensions_allowed CHECK (
    (width IS NULL AND height IS NULL AND state NOT IN ('READY'))
    OR (width BETWEEN 1 AND 2560 AND height BETWEEN 1 AND 2560)
  ),
  ADD CONSTRAINT sj_media_checksum_format CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT sj_media_filename_present CHECK (NULLIF(BTRIM(source_file_name_sanitized), '') IS NOT NULL);

ALTER TABLE public.sj_publication_version_media
  ADD CONSTRAINT sj_version_media_order CHECK (sort_order BETWEEN 0 AND 9),
  ADD CONSTRAINT sj_version_media_alt_text CHECK (CHAR_LENGTH(BTRIM(alt_text)) BETWEEN 3 AND 240);

CREATE UNIQUE INDEX sj_publication_version_one_cover
  ON public.sj_publication_version_media(publication_version_id)
  WHERE is_cover;

ALTER TABLE public.sj_sync_outbox
  ADD CONSTRAINT sj_outbox_event_type_v1 CHECK (event_type IN (
    'UPSERT_BPRS_PROFILE',
    'UPSERT_WHATSAPP_CONTACT',
    'REVOKE_WHATSAPP_CONTACT',
    'UPSERT_PUBLICATION_SNAPSHOT',
    'UNPUBLISH_PUBLICATION',
    'ARCHIVE_PUBLICATION',
    'REVOKE_MEDIA'
  )),
  ADD CONSTRAINT sj_outbox_aggregate_version_positive CHECK (aggregate_version > 0),
  ADD CONSTRAINT sj_outbox_schema_v1 CHECK (schema_version = 1),
  ADD CONSTRAINT sj_outbox_checksum_format CHECK (payload_checksum ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT sj_outbox_payload_object CHECK (jsonb_typeof(payload_json) = 'object'),
  ADD CONSTRAINT sj_outbox_attempt_nonnegative CHECK (attempt_count >= 0),
  ADD CONSTRAINT sj_outbox_priority_range CHECK (priority BETWEEN 1 AND 1000);

ALTER TABLE public.sj_sync_attempts
  ADD CONSTRAINT sj_sync_attempt_number_positive CHECK (attempt_number > 0),
  ADD CONSTRAINT sj_sync_http_status_range CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  ADD CONSTRAINT sj_sync_result_safe CHECK (result IN ('ACKNOWLEDGED', 'RETRYABLE_ERROR', 'PERMANENT_ERROR', 'QUARANTINED'));

ALTER TABLE public.sj_reconciliation_runs
  ADD CONSTRAINT sj_reconciliation_counts_nonnegative CHECK (count_checked >= 0 AND count_mismatch >= 0 AND count_mismatch <= count_checked),
  ADD CONSTRAINT sj_reconciliation_checksum_format CHECK (
    local_manifest_checksum ~ '^[0-9a-f]{64}$'
    AND (central_manifest_checksum IS NULL OR central_manifest_checksum ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT sj_reconciliation_initiator CHECK (initiated_by_type IN ('USER', 'SCHEDULED_WORKER'));

ALTER TABLE public.sj_taxonomy_versions
  ADD CONSTRAINT sj_taxonomy_version_positive CHECK (version > 0),
  ADD CONSTRAINT sj_taxonomy_checksum_format CHECK (checksum ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT sj_taxonomy_signature_object CHECK (jsonb_typeof(signature_metadata) = 'object');

ALTER TABLE public.sj_taxonomy_items
  ADD CONSTRAINT sj_taxonomy_item_version_positive CHECK (taxonomy_version > 0),
  ADD CONSTRAINT sj_taxonomy_code_format CHECK (code ~ '^[A-Z0-9_]{2,80}$'),
  ADD CONSTRAINT sj_taxonomy_label_present CHECK (NULLIF(BTRIM(label_id), '') IS NOT NULL),
  ADD CONSTRAINT sj_taxonomy_schema_object CHECK (jsonb_typeof(required_field_schema) = 'object');

CREATE UNIQUE INDEX sj_taxonomy_one_active_version
  ON public.sj_taxonomy_versions(is_active)
  WHERE is_active;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_is_worker()
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  -- The caller identity must survive SECURITY DEFINER helpers. Inside those
  -- helpers current_user is the policy-owner role, while session_user remains
  -- the dedicated worker login that opened the connection.
  SELECT pg_has_role(session_user, 'ruwang_sj_worker', 'member')
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_has_global_access(capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.ruwang_arsip_sj_is_worker()
    OR public.ruwang_arsip_has_menu_permission(
      ARRAY['/dashboard/seputar-jaminan']::text[],
      capability
    )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_can_access_division(target_division_id text, capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.ruwang_arsip_sj_is_worker()
    OR (
      public.ruwang_arsip_has_menu_permission(
        ARRAY['/dashboard/seputar-jaminan']::text[],
        capability
      )
      AND (
        target_division_id = public.ruwang_arsip_current_user_division_id()
        OR public.ruwang_arsip_has_menu_feature(
          ARRAY['/dashboard/seputar-jaminan']::text[],
          'sj_manage_all'
        )
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_can_access_publication(target_publication_id text, capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.sj_publications publication
    WHERE publication.id = target_publication_id
      AND public.ruwang_arsip_sj_can_access_division(publication.owner_division_id, capability)
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_can_access_version(target_version_id text, capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.sj_publication_versions version
    WHERE version.id = target_version_id
      AND public.ruwang_arsip_sj_can_access_publication(version.publication_id, capability)
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_json_has_denied_key(target jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  entry record;
  value_item jsonb;
BEGIN
  IF jsonb_typeof(target) = 'object' THEN
    FOR entry IN SELECT key, value FROM jsonb_each(target) LOOP
      IF LOWER(entry.key) = ANY (ARRAY[
        'debtor_id','cif','nik','npwp','date_of_birth','owner_name','contract_id',
        'account_number','facility_number','outstanding','arrears','source_collateral_id',
        'collateral_number','certificate_number','bpkb_number','street','rt','rw',
        'village','district','latitude','longitude','coordinates','market_value',
        'liquidation_value','appraisal_value','price','internal_price','deed_number',
        'notary','policy_number','document','document_url','raw_data','manual_reason',
        'manual_evidence_document_id','user_id','username','email','role','division_id',
        'password','jwt','refresh_token','api_key','private_key','secret','session',
        'cookie','database_url','storage_path','bucket','hostname','ip_address',
        'stack_trace','signature','nonce','original_filename','local_path','exif','gps'
      ]) THEN
        RETURN true;
      END IF;
      IF public.ruwang_arsip_sj_json_has_denied_key(entry.value) THEN
        RETURN true;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(target) = 'array' THEN
    FOR value_item IN SELECT value FROM jsonb_array_elements(target) LOOP
      IF public.ruwang_arsip_sj_json_has_denied_key(value_item) THEN
        RETURN true;
      END IF;
    END LOOP;
  END IF;
  RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_validate_version_for_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  publication_record public.sj_publications%ROWTYPE;
  detail_count integer;
  media_count integer;
  cover_count integer;
  media_total bigint;
BEGIN
  IF NEW.state NOT IN ('IN_REVIEW', 'APPROVED')
     OR NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NEW;
  END IF;

  SELECT * INTO STRICT publication_record
  FROM public.sj_publications
  WHERE id = NEW.publication_id;

  IF NEW.submitted_by IS NULL OR NEW.submitted_at IS NULL THEN
    RAISE EXCEPTION 'Snapshot publikasi wajib memiliki pengaju dan waktu pengajuan';
  END IF;
  IF NEW.state = 'APPROVED' AND (
    NEW.approved_by IS NULL OR NEW.approved_at IS NULL
    OR NEW.approved_by = NEW.last_edited_by
    OR NEW.approved_by = NEW.submitted_by
  ) THEN
    RAISE EXCEPTION 'Pemeriksa publikasi harus berbeda dari pembuat/pengaju';
  END IF;
  IF public.ruwang_arsip_sj_json_has_denied_key(NEW.public_payload_json) THEN
    RAISE EXCEPTION 'Payload publik mengandung field yang dilarang';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sj_taxonomy_items item
    WHERE item.id = NEW.taxonomy_item_id
      AND item.taxonomy_version = NEW.taxonomy_version
      AND item.category = publication_record.asset_category
      AND item.is_active
  ) THEN
    RAISE EXCEPTION 'Kategori dan taxonomy publikasi tidak konsisten';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.sj_whatsapp_contact_versions version
    JOIN public.sj_whatsapp_contacts contact ON contact.id = version.contact_id
    WHERE version.id = NEW.whatsapp_contact_version_id
      AND version.state = 'VERIFIED'
      AND contact.state = 'VERIFIED'
      AND contact.revoked_at IS NULL
      AND contact.current_version_id = version.id
  ) THEN
    RAISE EXCEPTION 'Kontak WhatsApp belum aktif dan terverifikasi';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.sj_public_profile_versions version
    JOIN public.sj_public_profiles profile ON profile.id = version.profile_id
    WHERE version.id = NEW.profile_version_id
      AND version.state = 'APPROVED'
      AND profile.state = 'VERIFIED'
      AND profile.current_version_id = version.id
  ) THEN
    RAISE EXCEPTION 'Profil publik BPRS belum disetujui';
  END IF;

  SELECT
    (SELECT COUNT(*) FROM public.sj_land_details WHERE publication_version_id = NEW.id)
    + (SELECT COUNT(*) FROM public.sj_building_details WHERE publication_version_id = NEW.id)
    + (SELECT COUNT(*) FROM public.sj_machine_details WHERE publication_version_id = NEW.id)
    + (SELECT COUNT(*) FROM public.sj_vehicle_details WHERE publication_version_id = NEW.id)
  INTO detail_count;
  IF detail_count <> 1 THEN
    RAISE EXCEPTION 'Snapshot wajib memiliki tepat satu detail kategori';
  END IF;
  IF (publication_record.asset_category = 'LAND' AND NOT EXISTS (SELECT 1 FROM public.sj_land_details WHERE publication_version_id = NEW.id))
     OR (publication_record.asset_category = 'BUILDING' AND NOT EXISTS (SELECT 1 FROM public.sj_building_details WHERE publication_version_id = NEW.id))
     OR (publication_record.asset_category = 'MACHINE_EQUIPMENT' AND NOT EXISTS (SELECT 1 FROM public.sj_machine_details WHERE publication_version_id = NEW.id))
     OR (publication_record.asset_category = 'VEHICLE' AND NOT EXISTS (SELECT 1 FROM public.sj_vehicle_details WHERE publication_version_id = NEW.id)) THEN
    RAISE EXCEPTION 'Detail kategori tidak sesuai dengan publikasi';
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE link.is_cover), COALESCE(SUM(media.size_bytes), 0)
  INTO media_count, cover_count, media_total
  FROM public.sj_publication_version_media link
  JOIN public.sj_media_assets media ON media.id = link.media_asset_id
  WHERE link.publication_version_id = NEW.id
    AND media.owner_division_id = publication_record.owner_division_id
    AND media.state = 'READY'
    AND media.central_media_id IS NOT NULL
    AND media.detected_mime IN ('image/jpeg', 'image/png', 'image/webp')
    AND media.width BETWEEN 1 AND 2560
    AND media.height BETWEEN 1 AND 2560;

  IF media_count NOT BETWEEN 1 AND 10 OR cover_count <> 1 OR media_total > 52428800 THEN
    RAISE EXCEPTION 'Media publikasi belum memenuhi aturan 1-10 foto, satu sampul, dan maksimum 50 MB';
  END IF;
  IF media_count <> (SELECT COUNT(*) FROM public.sj_publication_version_media WHERE publication_version_id = NEW.id) THEN
    RAISE EXCEPTION 'Semua media harus siap di pusat dan berasal dari divisi pemilik publikasi';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_guard_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.state <> 'DRAFT' THEN
    IF OLD.state = 'IN_REVIEW' AND NEW.state = 'APPROVED' THEN
      IF (
        to_jsonb(NEW) - ARRAY['state','submitted_by','submitted_at','approved_by','approved_at','rejection_reason','public_payload_json','payload_checksum']
        IS DISTINCT FROM
        to_jsonb(OLD) - ARRAY['state','submitted_by','submitted_at','approved_by','approved_at','rejection_reason','public_payload_json','payload_checksum']
      ) THEN
        RAISE EXCEPTION 'Isi bisnis snapshot tidak dapat berubah saat persetujuan';
      END IF;
    ELSIF (
      to_jsonb(NEW) - ARRAY['state','submitted_by','submitted_at','approved_by','approved_at','rejection_reason']
      IS DISTINCT FROM
      to_jsonb(OLD) - ARRAY['state','submitted_by','submitted_at','approved_by','approved_at','rejection_reason']
    ) THEN
      RAISE EXCEPTION 'Snapshot yang sudah diajukan tidak dapat diubah';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_guard_profile_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.state <> 'DRAFT' AND (
    to_jsonb(NEW) - ARRAY['state','submitted_at','approved_by','approved_at','rejection_reason']
    IS DISTINCT FROM
    to_jsonb(OLD) - ARRAY['state','submitted_at','approved_by','approved_at','rejection_reason']
  ) THEN
    RAISE EXCEPTION 'Snapshot profil yang sudah diajukan tidak dapat diubah';
  END IF;
  IF NEW.state = 'APPROVED' AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL OR NEW.approved_by = NEW.created_by) THEN
    RAISE EXCEPTION 'Pemeriksa profil harus berbeda dari pembuat';
  END IF;
  IF public.ruwang_arsip_sj_json_has_denied_key(NEW.payload_json) THEN
    RAISE EXCEPTION 'Payload profil mengandung field yang dilarang';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_guard_contact_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.state <> 'DRAFT' AND (
    to_jsonb(NEW) - ARRAY['state','submitted_at','verified_by','verified_at','rejection_reason']
    IS DISTINCT FROM
    to_jsonb(OLD) - ARRAY['state','submitted_at','verified_by','verified_at','rejection_reason']
  ) THEN
    RAISE EXCEPTION 'Snapshot kontak yang sudah diajukan tidak dapat diubah';
  END IF;
  IF NEW.state = 'VERIFIED' AND (NEW.verified_by IS NULL OR NEW.verified_at IS NULL OR NEW.verified_by = NEW.created_by) THEN
    RAISE EXCEPTION 'Pemeriksa kontak harus berbeda dari pembuat';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_guard_child_draft()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_version_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_version_id := OLD.publication_version_id;
  ELSE
    target_version_id := NEW.publication_version_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sj_publication_versions version
    WHERE version.id = target_version_id AND version.state = 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'Detail snapshot hanya dapat diubah saat masih draf';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_guard_publication_version_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sj_publication_versions version
    WHERE version.id = NEW.current_version_id AND version.publication_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Versi aktif tidak dimiliki publikasi ini';
  END IF;
  IF NEW.published_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sj_publication_versions version
    WHERE version.id = NEW.published_version_id AND version.publication_id = NEW.id AND version.state = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Versi tayang harus versi disetujui milik publikasi ini';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_guard_profile_version_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sj_public_profile_versions version
    WHERE version.id = NEW.current_version_id
      AND version.profile_id = NEW.id
      AND version.state = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Versi profil aktif harus snapshot disetujui milik profil ini';
  END IF;
  IF NEW.state = 'VERIFIED' AND NEW.current_version_id IS NULL THEN
    RAISE EXCEPTION 'Profil terverifikasi wajib memiliki versi aktif';
  END IF;
  IF NEW.state = 'VERIFIED' AND NOT EXISTS (
    SELECT 1 FROM public.sj_media_assets media
    WHERE media.id = NEW.logo_media_id
      AND media.purpose = 'BPRS_PUBLIC_MARK'
      AND media.state = 'READY'
      AND media.central_media_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Profil terverifikasi wajib memiliki logo publik yang siap';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_guard_contact_version_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sj_whatsapp_contact_versions version
    WHERE version.id = NEW.current_version_id
      AND version.contact_id = NEW.id
      AND version.state = 'VERIFIED'
  ) THEN
    RAISE EXCEPTION 'Versi kontak aktif harus snapshot terverifikasi milik kontak ini';
  END IF;
  IF NEW.state = 'VERIFIED' AND (NEW.current_version_id IS NULL OR NEW.last_verified_at IS NULL OR NEW.revoked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Kontak terverifikasi wajib memiliki versi aktif dan waktu verifikasi';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_guard_public_payload()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.ruwang_arsip_sj_json_has_denied_key(NEW.payload_json) THEN
    RAISE EXCEPTION 'Outbox menolak field internal atau sensitif';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER sj_publication_version_validate_review
  BEFORE UPDATE OF state ON public.sj_publication_versions
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_validate_version_for_review();
CREATE TRIGGER sj_publication_version_immutable
  BEFORE UPDATE ON public.sj_publication_versions
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_version_immutability();
CREATE TRIGGER sj_profile_version_immutable
  BEFORE INSERT OR UPDATE ON public.sj_public_profile_versions
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_profile_version_immutability();
CREATE TRIGGER sj_contact_version_immutable
  BEFORE INSERT OR UPDATE ON public.sj_whatsapp_contact_versions
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_contact_version_immutability();
CREATE TRIGGER sj_publication_version_links
  BEFORE INSERT OR UPDATE OF current_version_id, published_version_id ON public.sj_publications
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_publication_version_links();
CREATE TRIGGER sj_profile_version_link
  BEFORE INSERT OR UPDATE OF current_version_id, state, logo_media_id ON public.sj_public_profiles
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_profile_version_link();
CREATE TRIGGER sj_contact_version_link
  BEFORE INSERT OR UPDATE OF current_version_id, state, last_verified_at, revoked_at ON public.sj_whatsapp_contacts
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_contact_version_link();
CREATE TRIGGER sj_outbox_public_payload
  BEFORE INSERT OR UPDATE OF payload_json ON public.sj_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_public_payload();

CREATE TRIGGER sj_land_detail_draft BEFORE INSERT OR UPDATE OR DELETE ON public.sj_land_details
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_child_draft();
CREATE TRIGGER sj_building_detail_draft BEFORE INSERT OR UPDATE OR DELETE ON public.sj_building_details
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_child_draft();
CREATE TRIGGER sj_machine_detail_draft BEFORE INSERT OR UPDATE OR DELETE ON public.sj_machine_details
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_child_draft();
CREATE TRIGGER sj_vehicle_detail_draft BEFORE INSERT OR UPDATE OR DELETE ON public.sj_vehicle_details
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_child_draft();
CREATE TRIGGER sj_version_media_draft BEFORE INSERT OR UPDATE OR DELETE ON public.sj_publication_version_media
  FOR EACH ROW EXECUTE FUNCTION public.ruwang_arsip_sj_guard_child_draft();

ALTER TABLE public.sj_integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_integration_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_public_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_public_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_public_profile_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_public_profile_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_whatsapp_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_whatsapp_contact_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_whatsapp_contact_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_publications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_publication_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_publication_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_land_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_land_details FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_building_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_building_details FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_machine_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_machine_details FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_vehicle_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_vehicle_details FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_media_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_publication_version_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_publication_version_media FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_publication_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_publication_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_sync_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_sync_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_sync_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_sync_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_reconciliation_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_taxonomy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_taxonomy_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sj_taxonomy_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sj_taxonomy_items FORCE ROW LEVEL SECURITY;

-- Global BPRS-level configuration, profiles, contacts, taxonomy and sync status.
CREATE POLICY sj_integration_settings_read ON public.sj_integration_settings FOR SELECT USING (public.ruwang_arsip_sj_has_global_access('read'));
CREATE POLICY sj_integration_settings_create ON public.sj_integration_settings FOR INSERT WITH CHECK (public.ruwang_arsip_sj_has_global_access('create'));
CREATE POLICY sj_integration_settings_update ON public.sj_integration_settings FOR UPDATE USING (public.ruwang_arsip_sj_has_global_access('update')) WITH CHECK (public.ruwang_arsip_sj_has_global_access('update'));
CREATE POLICY sj_public_profiles_read ON public.sj_public_profiles FOR SELECT USING (public.ruwang_arsip_sj_has_global_access('read'));
CREATE POLICY sj_public_profiles_create ON public.sj_public_profiles FOR INSERT WITH CHECK (public.ruwang_arsip_sj_has_global_access('create'));
CREATE POLICY sj_public_profiles_update ON public.sj_public_profiles FOR UPDATE USING (public.ruwang_arsip_sj_has_global_access('update')) WITH CHECK (public.ruwang_arsip_sj_has_global_access('update'));
CREATE POLICY sj_public_profile_versions_read ON public.sj_public_profile_versions FOR SELECT USING (public.ruwang_arsip_sj_has_global_access('read'));
CREATE POLICY sj_public_profile_versions_create ON public.sj_public_profile_versions FOR INSERT WITH CHECK (public.ruwang_arsip_sj_has_global_access('create'));
CREATE POLICY sj_public_profile_versions_update ON public.sj_public_profile_versions FOR UPDATE USING (public.ruwang_arsip_sj_has_global_access('update')) WITH CHECK (public.ruwang_arsip_sj_has_global_access('update'));
CREATE POLICY sj_whatsapp_contacts_read ON public.sj_whatsapp_contacts FOR SELECT USING (public.ruwang_arsip_sj_has_global_access('read'));
CREATE POLICY sj_whatsapp_contacts_create ON public.sj_whatsapp_contacts FOR INSERT WITH CHECK (public.ruwang_arsip_sj_has_global_access('create'));
CREATE POLICY sj_whatsapp_contacts_update ON public.sj_whatsapp_contacts FOR UPDATE USING (public.ruwang_arsip_sj_has_global_access('update')) WITH CHECK (public.ruwang_arsip_sj_has_global_access('update'));
CREATE POLICY sj_whatsapp_contact_versions_read ON public.sj_whatsapp_contact_versions FOR SELECT USING (public.ruwang_arsip_sj_has_global_access('read'));
CREATE POLICY sj_whatsapp_contact_versions_create ON public.sj_whatsapp_contact_versions FOR INSERT WITH CHECK (public.ruwang_arsip_sj_has_global_access('create'));
CREATE POLICY sj_whatsapp_contact_versions_update ON public.sj_whatsapp_contact_versions FOR UPDATE USING (public.ruwang_arsip_sj_has_global_access('update')) WITH CHECK (public.ruwang_arsip_sj_has_global_access('update'));
CREATE POLICY sj_sync_outbox_read ON public.sj_sync_outbox FOR SELECT USING (public.ruwang_arsip_sj_has_global_access('read'));
CREATE POLICY sj_sync_outbox_create ON public.sj_sync_outbox FOR INSERT WITH CHECK (public.ruwang_arsip_sj_has_global_access('create'));
CREATE POLICY sj_sync_outbox_update ON public.sj_sync_outbox FOR UPDATE USING (public.ruwang_arsip_sj_has_global_access('update')) WITH CHECK (public.ruwang_arsip_sj_has_global_access('update'));
CREATE POLICY sj_sync_attempts_read ON public.sj_sync_attempts FOR SELECT USING (public.ruwang_arsip_sj_has_global_access('read'));
CREATE POLICY sj_sync_attempts_create ON public.sj_sync_attempts FOR INSERT WITH CHECK (public.ruwang_arsip_sj_has_global_access('create'));
CREATE POLICY sj_sync_attempts_update ON public.sj_sync_attempts FOR UPDATE USING (public.ruwang_arsip_sj_has_global_access('update')) WITH CHECK (public.ruwang_arsip_sj_has_global_access('update'));
CREATE POLICY sj_reconciliation_runs_read ON public.sj_reconciliation_runs FOR SELECT USING (public.ruwang_arsip_sj_has_global_access('read'));
CREATE POLICY sj_reconciliation_runs_create ON public.sj_reconciliation_runs FOR INSERT WITH CHECK (public.ruwang_arsip_sj_has_global_access('create'));
CREATE POLICY sj_reconciliation_runs_update ON public.sj_reconciliation_runs FOR UPDATE USING (public.ruwang_arsip_sj_has_global_access('update')) WITH CHECK (public.ruwang_arsip_sj_has_global_access('update'));
CREATE POLICY sj_taxonomy_versions_read ON public.sj_taxonomy_versions FOR SELECT USING (public.ruwang_arsip_sj_has_global_access('read'));
CREATE POLICY sj_taxonomy_versions_create ON public.sj_taxonomy_versions FOR INSERT WITH CHECK (public.ruwang_arsip_sj_has_global_access('create'));
CREATE POLICY sj_taxonomy_versions_update ON public.sj_taxonomy_versions FOR UPDATE USING (public.ruwang_arsip_sj_has_global_access('update')) WITH CHECK (public.ruwang_arsip_sj_has_global_access('update'));
CREATE POLICY sj_taxonomy_items_read ON public.sj_taxonomy_items FOR SELECT USING (public.ruwang_arsip_sj_has_global_access('read'));
CREATE POLICY sj_taxonomy_items_create ON public.sj_taxonomy_items FOR INSERT WITH CHECK (public.ruwang_arsip_sj_has_global_access('create'));
CREATE POLICY sj_taxonomy_items_update ON public.sj_taxonomy_items FOR UPDATE USING (public.ruwang_arsip_sj_has_global_access('update')) WITH CHECK (public.ruwang_arsip_sj_has_global_access('update'));

CREATE POLICY sj_publications_read ON public.sj_publications FOR SELECT
  USING (public.ruwang_arsip_sj_can_access_division(owner_division_id, 'read'));
CREATE POLICY sj_publications_create ON public.sj_publications FOR INSERT
  WITH CHECK (public.ruwang_arsip_sj_can_access_division(owner_division_id, 'create'));
CREATE POLICY sj_publications_update ON public.sj_publications FOR UPDATE
  USING (public.ruwang_arsip_sj_can_access_division(owner_division_id, 'update'))
  WITH CHECK (public.ruwang_arsip_sj_can_access_division(owner_division_id, 'update'));

CREATE POLICY sj_publication_versions_read ON public.sj_publication_versions FOR SELECT
  USING (public.ruwang_arsip_sj_can_access_publication(publication_id, 'read'));
CREATE POLICY sj_publication_versions_create ON public.sj_publication_versions FOR INSERT
  WITH CHECK (public.ruwang_arsip_sj_can_access_publication(publication_id, 'create'));
CREATE POLICY sj_publication_versions_update ON public.sj_publication_versions FOR UPDATE
  USING (public.ruwang_arsip_sj_can_access_publication(publication_id, 'update'))
  WITH CHECK (public.ruwang_arsip_sj_can_access_publication(publication_id, 'update'));

CREATE POLICY sj_land_details_read ON public.sj_land_details FOR SELECT USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'read'));
CREATE POLICY sj_land_details_create ON public.sj_land_details FOR INSERT WITH CHECK (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'create'));
CREATE POLICY sj_land_details_update ON public.sj_land_details FOR UPDATE USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'update')) WITH CHECK (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'update'));
CREATE POLICY sj_land_details_delete ON public.sj_land_details FOR DELETE USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'delete'));
CREATE POLICY sj_building_details_read ON public.sj_building_details FOR SELECT USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'read'));
CREATE POLICY sj_building_details_create ON public.sj_building_details FOR INSERT WITH CHECK (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'create'));
CREATE POLICY sj_building_details_update ON public.sj_building_details FOR UPDATE USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'update')) WITH CHECK (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'update'));
CREATE POLICY sj_building_details_delete ON public.sj_building_details FOR DELETE USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'delete'));
CREATE POLICY sj_machine_details_read ON public.sj_machine_details FOR SELECT USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'read'));
CREATE POLICY sj_machine_details_create ON public.sj_machine_details FOR INSERT WITH CHECK (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'create'));
CREATE POLICY sj_machine_details_update ON public.sj_machine_details FOR UPDATE USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'update')) WITH CHECK (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'update'));
CREATE POLICY sj_machine_details_delete ON public.sj_machine_details FOR DELETE USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'delete'));
CREATE POLICY sj_vehicle_details_read ON public.sj_vehicle_details FOR SELECT USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'read'));
CREATE POLICY sj_vehicle_details_create ON public.sj_vehicle_details FOR INSERT WITH CHECK (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'create'));
CREATE POLICY sj_vehicle_details_update ON public.sj_vehicle_details FOR UPDATE USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'update')) WITH CHECK (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'update'));
CREATE POLICY sj_vehicle_details_delete ON public.sj_vehicle_details FOR DELETE USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'delete'));
CREATE POLICY sj_publication_version_media_read ON public.sj_publication_version_media FOR SELECT USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'read'));
CREATE POLICY sj_publication_version_media_create ON public.sj_publication_version_media FOR INSERT WITH CHECK (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'create'));
CREATE POLICY sj_publication_version_media_update ON public.sj_publication_version_media FOR UPDATE USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'update')) WITH CHECK (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'update'));
CREATE POLICY sj_publication_version_media_delete ON public.sj_publication_version_media FOR DELETE USING (public.ruwang_arsip_sj_can_access_version(publication_version_id, 'delete'));

CREATE POLICY sj_media_assets_read ON public.sj_media_assets FOR SELECT
  USING (public.ruwang_arsip_sj_can_access_division(owner_division_id, 'read'));
CREATE POLICY sj_media_assets_create ON public.sj_media_assets FOR INSERT
  WITH CHECK (public.ruwang_arsip_sj_can_access_division(owner_division_id, 'create'));
CREATE POLICY sj_media_assets_update ON public.sj_media_assets FOR UPDATE
  USING (public.ruwang_arsip_sj_can_access_division(owner_division_id, 'update'))
  WITH CHECK (public.ruwang_arsip_sj_can_access_division(owner_division_id, 'update'));

CREATE POLICY sj_publication_reviews_read ON public.sj_publication_reviews FOR SELECT
  USING (public.ruwang_arsip_sj_can_access_publication(publication_id, 'read'));
CREATE POLICY sj_publication_reviews_create ON public.sj_publication_reviews FOR INSERT
  WITH CHECK (
    reviewer_id = public.ruwang_arsip_current_user_id()
    AND public.ruwang_arsip_sj_can_access_publication(publication_id, 'update')
  );

GRANT USAGE ON SCHEMA public TO ruwang_arsip_app, ruwang_sj_worker;
GRANT USAGE ON TYPE
  public.sj_publication_states, public.sj_publication_source_types,
  public.sj_public_availabilities, public.sj_asset_categories, public.sj_sync_states,
  public.sj_media_states, public.sj_contact_states, public.sj_profile_states,
  public.sj_storage_backends, public.sj_connection_states, public.sj_snapshot_states,
  public.sj_review_actions, public.sj_reconciliation_states
TO ruwang_arsip_app, ruwang_sj_worker;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO ruwang_arsip_policy;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.sj_integration_settings, public.sj_public_profiles, public.sj_public_profile_versions,
  public.sj_whatsapp_contacts, public.sj_whatsapp_contact_versions,
  public.sj_publications, public.sj_publication_versions,
  public.sj_land_details, public.sj_building_details, public.sj_machine_details,
  public.sj_vehicle_details, public.sj_media_assets, public.sj_publication_version_media,
  public.sj_publication_reviews, public.sj_sync_outbox, public.sj_reconciliation_runs
TO ruwang_arsip_app;
GRANT DELETE ON TABLE
  public.sj_land_details, public.sj_building_details, public.sj_machine_details,
  public.sj_vehicle_details, public.sj_publication_version_media
TO ruwang_arsip_app;
REVOKE DELETE ON TABLE
  public.sj_integration_settings, public.sj_public_profiles, public.sj_public_profile_versions,
  public.sj_whatsapp_contacts, public.sj_whatsapp_contact_versions,
  public.sj_publications, public.sj_publication_versions, public.sj_media_assets,
  public.sj_publication_reviews, public.sj_sync_outbox, public.sj_sync_attempts,
  public.sj_reconciliation_runs, public.sj_taxonomy_versions, public.sj_taxonomy_items
FROM ruwang_arsip_app;
GRANT SELECT ON TABLE public.sj_sync_attempts, public.sj_taxonomy_versions, public.sj_taxonomy_items
TO ruwang_arsip_app;

GRANT SELECT ON TABLE
  public.sj_integration_settings, public.sj_public_profiles, public.sj_public_profile_versions,
  public.sj_whatsapp_contacts, public.sj_whatsapp_contact_versions,
  public.sj_publications, public.sj_publication_versions, public.sj_land_details,
  public.sj_building_details, public.sj_machine_details, public.sj_vehicle_details,
  public.sj_media_assets, public.sj_publication_version_media, public.sj_sync_outbox,
  public.sj_sync_attempts, public.sj_reconciliation_runs, public.sj_taxonomy_versions,
  public.sj_taxonomy_items
TO ruwang_sj_worker;
GRANT UPDATE (state, available_at, attempt_count, last_error_code, locked_at, locked_by, acknowledged_at)
  ON public.sj_sync_outbox TO ruwang_sj_worker;
GRANT INSERT ON public.sj_sync_outbox TO ruwang_sj_worker;
GRANT INSERT, UPDATE ON public.sj_sync_attempts TO ruwang_sj_worker;
GRANT INSERT, UPDATE ON public.sj_reconciliation_runs TO ruwang_sj_worker;
GRANT INSERT, UPDATE ON public.sj_taxonomy_versions, public.sj_taxonomy_items TO ruwang_sj_worker;
GRANT UPDATE (last_success_at, last_error_at, last_error_code, connection_state, updated_at)
  ON public.sj_integration_settings TO ruwang_sj_worker;
GRANT UPDATE (sync_state, aggregate_version, updated_at)
  ON public.sj_public_profiles, public.sj_whatsapp_contacts TO ruwang_sj_worker;
GRANT UPDATE (state, sync_state, central_publication_id, aggregate_version, lock_version, next_reconfirmation_at, last_sync_error_code, updated_at)
  ON public.sj_publications TO ruwang_sj_worker;
GRANT UPDATE (central_media_id, upload_session_id, state, rejection_code, updated_at, revoked_at)
  ON public.sj_media_assets TO ruwang_sj_worker;

ALTER FUNCTION public.ruwang_arsip_sj_has_global_access(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_sj_can_access_division(text, text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_sj_can_access_publication(text, text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_sj_can_access_version(text, text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_sj_validate_version_for_review() OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_sj_guard_child_draft() OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_sj_guard_publication_version_links() OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_sj_guard_profile_version_link() OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_sj_guard_contact_version_link() OWNER TO ruwang_arsip_policy;

REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_is_worker() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_has_global_access(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_can_access_division(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_can_access_publication(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_can_access_version(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_json_has_denied_key(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_validate_version_for_review() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_guard_version_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_guard_profile_version_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_guard_contact_version_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_guard_child_draft() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_guard_publication_version_links() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_guard_profile_version_link() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_guard_contact_version_link() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_sj_guard_public_payload() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_is_worker() TO ruwang_arsip_app, ruwang_sj_worker, ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_has_global_access(text) TO ruwang_arsip_app, ruwang_sj_worker, ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_can_access_division(text, text) TO ruwang_arsip_app, ruwang_sj_worker, ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_can_access_publication(text, text) TO ruwang_arsip_app, ruwang_sj_worker, ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_can_access_version(text, text) TO ruwang_arsip_app, ruwang_sj_worker, ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_json_has_denied_key(jsonb) TO ruwang_arsip_app, ruwang_sj_worker, ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_guard_version_immutability() TO ruwang_arsip_app, ruwang_sj_worker, ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_guard_profile_version_immutability() TO ruwang_arsip_app, ruwang_sj_worker, ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_guard_contact_version_immutability() TO ruwang_arsip_app, ruwang_sj_worker, ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_guard_profile_version_link() TO ruwang_arsip_app, ruwang_sj_worker, ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_guard_contact_version_link() TO ruwang_arsip_app, ruwang_sj_worker, ruwang_arsip_policy;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_sj_guard_public_payload() TO ruwang_arsip_app, ruwang_sj_worker, ruwang_arsip_policy;
