-- CreateEnum
CREATE TYPE "sj_publication_states" AS ENUM ('DRAFT', 'IN_REVIEW', 'REVISION_REQUIRED', 'APPROVED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "sj_publication_source_types" AS ENUM ('COLLATERAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "sj_public_availabilities" AS ENUM ('AVAILABLE', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "sj_asset_categories" AS ENUM ('LAND', 'BUILDING', 'MACHINE_EQUIPMENT', 'VEHICLE');

-- CreateEnum
CREATE TYPE "sj_sync_states" AS ENUM ('NOT_QUEUED', 'QUEUED', 'SENDING', 'ACKNOWLEDGED', 'RETRYING', 'FAILED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "sj_media_states" AS ENUM ('DRAFT', 'UPLOAD_PENDING', 'UPLOADED', 'PROCESSING', 'READY', 'REJECTED', 'REVOKED', 'DELETION_PENDING', 'DELETED');

-- CreateEnum
CREATE TYPE "sj_contact_states" AS ENUM ('DRAFT', 'IN_REVIEW', 'VERIFIED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "sj_profile_states" AS ENUM ('DRAFT', 'IN_REVIEW', 'VERIFIED', 'REVISION_REQUIRED');

-- CreateEnum
CREATE TYPE "sj_storage_backends" AS ENUM ('FILESYSTEM', 'S3_COMPATIBLE');

-- CreateEnum
CREATE TYPE "sj_connection_states" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "sj_snapshot_states" AS ENUM ('DRAFT', 'IN_REVIEW', 'VERIFIED', 'REVISION_REQUIRED', 'APPROVED');

-- CreateEnum
CREATE TYPE "sj_review_actions" AS ENUM ('SUBMITTED', 'REVISION_REQUESTED', 'APPROVED', 'PUBLISH_REQUESTED', 'UNPUBLISHED', 'RECONFIRMED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "sj_reconciliation_states" AS ENUM ('PENDING', 'RUNNING', 'MATCHED', 'MISMATCH', 'FAILED');

-- CreateTable
CREATE TABLE "sj_integration_settings" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "central_base_url" TEXT NOT NULL,
    "contract_version" INTEGER NOT NULL DEFAULT 1,
    "taxonomy_version" INTEGER NOT NULL DEFAULT 1,
    "connection_state" "sj_connection_states" NOT NULL DEFAULT 'PENDING',
    "module_visible" BOOLEAN NOT NULL DEFAULT false,
    "draft_enabled" BOOLEAN NOT NULL DEFAULT false,
    "review_enabled" BOOLEAN NOT NULL DEFAULT false,
    "sync_enabled" BOOLEAN NOT NULL DEFAULT false,
    "publish_enabled" BOOLEAN NOT NULL DEFAULT false,
    "filesystem_upload_enabled" BOOLEAN NOT NULL DEFAULT false,
    "s3_upload_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_success_at" TIMESTAMP(3),
    "last_error_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sj_integration_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sj_public_profiles" (
    "id" TEXT NOT NULL,
    "singleton_key" TEXT NOT NULL DEFAULT 'BPRS_PUBLIC_PROFILE',
    "current_version_id" TEXT,
    "display_name" TEXT NOT NULL,
    "public_slug" TEXT NOT NULL,
    "city_regency" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "short_description" TEXT NOT NULL,
    "logo_media_id" TEXT,
    "website_url" TEXT,
    "state" "sj_profile_states" NOT NULL DEFAULT 'DRAFT',
    "aggregate_version" INTEGER NOT NULL DEFAULT 0,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "sync_state" "sj_sync_states" NOT NULL DEFAULT 'NOT_QUEUED',
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sj_public_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sj_public_profile_versions" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "payload_json" JSONB NOT NULL,
    "payload_checksum" TEXT NOT NULL,
    "state" "sj_snapshot_states" NOT NULL DEFAULT 'DRAFT',
    "created_by" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sj_public_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sj_whatsapp_contacts" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "phone_normalized" TEXT NOT NULL,
    "current_version_id" TEXT,
    "state" "sj_contact_states" NOT NULL DEFAULT 'DRAFT',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "aggregate_version" INTEGER NOT NULL DEFAULT 0,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "sync_state" "sj_sync_states" NOT NULL DEFAULT 'NOT_QUEUED',
    "last_verified_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sj_whatsapp_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sj_whatsapp_contact_versions" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "message_template_version" INTEGER NOT NULL DEFAULT 1,
    "state" "sj_snapshot_states" NOT NULL DEFAULT 'DRAFT',
    "created_by" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sj_whatsapp_contact_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sj_publications" (
    "id" TEXT NOT NULL,
    "public_reference_code" TEXT NOT NULL,
    "source_type" "sj_publication_source_types" NOT NULL,
    "source_collateral_id" TEXT,
    "manual_reason" TEXT,
    "manual_evidence_document_id" TEXT,
    "owner_division_id" TEXT NOT NULL,
    "asset_category" "sj_asset_categories" NOT NULL,
    "current_version_id" TEXT,
    "published_version_id" TEXT,
    "state" "sj_publication_states" NOT NULL DEFAULT 'DRAFT',
    "sync_state" "sj_sync_states" NOT NULL DEFAULT 'NOT_QUEUED',
    "next_reconfirmation_at" TIMESTAMP(3),
    "last_confirmed_at" TIMESTAMP(3),
    "central_publication_id" TEXT,
    "aggregate_version" INTEGER NOT NULL DEFAULT 0,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "last_sync_error_code" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "sj_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sj_publication_versions" (
    "id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "taxonomy_version" INTEGER NOT NULL DEFAULT 1,
    "taxonomy_item_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "city_regency" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "availability" "sj_public_availabilities" NOT NULL DEFAULT 'AVAILABLE',
    "whatsapp_contact_version_id" TEXT NOT NULL,
    "profile_version_id" TEXT NOT NULL,
    "public_payload_json" JSONB NOT NULL,
    "payload_checksum" TEXT NOT NULL,
    "state" "sj_snapshot_states" NOT NULL DEFAULT 'DRAFT',
    "last_edited_by" TEXT NOT NULL,
    "submitted_by" TEXT,
    "submitted_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sj_publication_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sj_land_details" (
    "publication_version_id" TEXT NOT NULL,
    "land_area_m2" DECIMAL(14,2) NOT NULL,
    "contour" TEXT,
    "road_access" TEXT,

    CONSTRAINT "sj_land_details_pkey" PRIMARY KEY ("publication_version_id")
);

-- CreateTable
CREATE TABLE "sj_building_details" (
    "publication_version_id" TEXT NOT NULL,
    "land_area_m2" DECIMAL(14,2),
    "building_area_m2" DECIMAL(14,2) NOT NULL,
    "floor_count" INTEGER,
    "public_usage" TEXT,

    CONSTRAINT "sj_building_details_pkey" PRIMARY KEY ("publication_version_id")
);

-- CreateTable
CREATE TABLE "sj_machine_details" (
    "publication_version_id" TEXT NOT NULL,
    "brand_or_manufacturer" TEXT,
    "model_or_type" TEXT NOT NULL,
    "manufacture_year" INTEGER,
    "public_capacity" TEXT,
    "public_condition" TEXT NOT NULL,

    CONSTRAINT "sj_machine_details_pkey" PRIMARY KEY ("publication_version_id")
);

-- CreateTable
CREATE TABLE "sj_vehicle_details" (
    "publication_version_id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model_or_type" TEXT NOT NULL,
    "manufacture_year" INTEGER,
    "transmission" TEXT,
    "fuel_type" TEXT,
    "mileage_km" DECIMAL(14,2),
    "public_condition" TEXT NOT NULL,

    CONSTRAINT "sj_vehicle_details_pkey" PRIMARY KEY ("publication_version_id")
);

-- CreateTable
CREATE TABLE "sj_media_assets" (
    "id" TEXT NOT NULL,
    "owner_division_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "logical_object_key" TEXT NOT NULL,
    "storage_backend" "sj_storage_backends" NOT NULL DEFAULT 'FILESYSTEM',
    "source_file_name_sanitized" TEXT NOT NULL,
    "detected_mime" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "state" "sj_media_states" NOT NULL DEFAULT 'DRAFT',
    "central_media_id" TEXT,
    "upload_session_id" TEXT,
    "rejection_code" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sj_media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sj_publication_version_media" (
    "id" TEXT NOT NULL,
    "publication_version_id" TEXT NOT NULL,
    "media_asset_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_cover" BOOLEAN NOT NULL DEFAULT false,
    "alt_text" TEXT NOT NULL,

    CONSTRAINT "sj_publication_version_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sj_publication_reviews" (
    "id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "publication_version_id" TEXT NOT NULL,
    "action" "sj_review_actions" NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "reason" TEXT,
    "safe_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sj_publication_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sj_sync_outbox" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "payload_json" JSONB NOT NULL,
    "payload_checksum" TEXT NOT NULL,
    "state" "sj_sync_states" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),

    CONSTRAINT "sj_sync_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sj_sync_attempts" (
    "id" TEXT NOT NULL,
    "outbox_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "result" TEXT NOT NULL,
    "http_status" INTEGER,
    "error_code" TEXT,
    "request_id" TEXT,

    CONSTRAINT "sj_sync_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sj_reconciliation_runs" (
    "id" TEXT NOT NULL,
    "initiated_by_type" TEXT NOT NULL,
    "initiated_by" TEXT,
    "state" "sj_reconciliation_states" NOT NULL DEFAULT 'PENDING',
    "local_manifest_checksum" TEXT NOT NULL,
    "central_manifest_checksum" TEXT,
    "count_checked" INTEGER NOT NULL DEFAULT 0,
    "count_mismatch" INTEGER NOT NULL DEFAULT 0,
    "safe_report_json" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "sj_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sj_taxonomy_versions" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "signature_metadata" JSONB NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sj_taxonomy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sj_taxonomy_items" (
    "id" TEXT NOT NULL,
    "taxonomy_version" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "parent_code" TEXT,
    "category" "sj_asset_categories" NOT NULL,
    "label_id" TEXT NOT NULL,
    "required_field_schema" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sj_taxonomy_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sj_integration_settings_institution_id_key" ON "sj_integration_settings"("institution_id");

-- CreateIndex
CREATE UNIQUE INDEX "sj_integration_settings_installation_id_key" ON "sj_integration_settings"("installation_id");

-- CreateIndex
CREATE INDEX "sj_integration_settings_connection_state_idx" ON "sj_integration_settings"("connection_state");

-- CreateIndex
CREATE UNIQUE INDEX "sj_public_profiles_current_version_id_key" ON "sj_public_profiles"("current_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "sj_public_profiles_singleton_key_key" ON "sj_public_profiles"("singleton_key");

-- CreateIndex
CREATE INDEX "sj_public_profiles_state_idx" ON "sj_public_profiles"("state");

-- CreateIndex
CREATE INDEX "sj_public_profiles_sync_state_idx" ON "sj_public_profiles"("sync_state");

-- CreateIndex
CREATE INDEX "sj_public_profiles_logo_media_id_idx" ON "sj_public_profiles"("logo_media_id");

-- CreateIndex
CREATE INDEX "sj_public_profiles_created_by_idx" ON "sj_public_profiles"("created_by");

-- CreateIndex
CREATE INDEX "sj_public_profiles_updated_by_idx" ON "sj_public_profiles"("updated_by");

-- CreateIndex
CREATE INDEX "sj_public_profile_versions_profile_id_state_idx" ON "sj_public_profile_versions"("profile_id", "state");

-- CreateIndex
CREATE INDEX "sj_public_profile_versions_created_by_idx" ON "sj_public_profile_versions"("created_by");

-- CreateIndex
CREATE INDEX "sj_public_profile_versions_approved_by_idx" ON "sj_public_profile_versions"("approved_by");

-- CreateIndex
CREATE UNIQUE INDEX "sj_public_profile_versions_profile_id_version_number_key" ON "sj_public_profile_versions"("profile_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "sj_whatsapp_contacts_current_version_id_key" ON "sj_whatsapp_contacts"("current_version_id");

-- CreateIndex
CREATE INDEX "sj_whatsapp_contacts_state_idx" ON "sj_whatsapp_contacts"("state");

-- CreateIndex
CREATE INDEX "sj_whatsapp_contacts_sync_state_idx" ON "sj_whatsapp_contacts"("sync_state");

-- CreateIndex
CREATE INDEX "sj_whatsapp_contacts_created_by_idx" ON "sj_whatsapp_contacts"("created_by");

-- CreateIndex
CREATE INDEX "sj_whatsapp_contacts_updated_by_idx" ON "sj_whatsapp_contacts"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "sj_whatsapp_contacts_phone_normalized_key" ON "sj_whatsapp_contacts"("phone_normalized");

-- CreateIndex
CREATE INDEX "sj_whatsapp_contact_versions_contact_id_state_idx" ON "sj_whatsapp_contact_versions"("contact_id", "state");

-- CreateIndex
CREATE INDEX "sj_whatsapp_contact_versions_created_by_idx" ON "sj_whatsapp_contact_versions"("created_by");

-- CreateIndex
CREATE INDEX "sj_whatsapp_contact_versions_verified_by_idx" ON "sj_whatsapp_contact_versions"("verified_by");

-- CreateIndex
CREATE UNIQUE INDEX "sj_whatsapp_contact_versions_contact_id_version_number_key" ON "sj_whatsapp_contact_versions"("contact_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "sj_publications_public_reference_code_key" ON "sj_publications"("public_reference_code");

-- CreateIndex
CREATE UNIQUE INDEX "sj_publications_current_version_id_key" ON "sj_publications"("current_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "sj_publications_published_version_id_key" ON "sj_publications"("published_version_id");

-- CreateIndex
CREATE INDEX "sj_publications_state_owner_division_id_idx" ON "sj_publications"("state", "owner_division_id");

-- CreateIndex
CREATE INDEX "sj_publications_next_reconfirmation_at_idx" ON "sj_publications"("next_reconfirmation_at");

-- CreateIndex
CREATE INDEX "sj_publications_source_collateral_id_idx" ON "sj_publications"("source_collateral_id");

-- CreateIndex
CREATE INDEX "sj_publications_owner_division_id_idx" ON "sj_publications"("owner_division_id");

-- CreateIndex
CREATE INDEX "sj_publications_sync_state_idx" ON "sj_publications"("sync_state");

-- CreateIndex
CREATE INDEX "sj_publications_created_by_idx" ON "sj_publications"("created_by");

-- CreateIndex
CREATE INDEX "sj_publications_updated_by_idx" ON "sj_publications"("updated_by");

-- CreateIndex
CREATE INDEX "sj_publication_versions_publication_id_state_idx" ON "sj_publication_versions"("publication_id", "state");

-- CreateIndex
CREATE INDEX "sj_publication_versions_whatsapp_contact_version_id_idx" ON "sj_publication_versions"("whatsapp_contact_version_id");

-- CreateIndex
CREATE INDEX "sj_publication_versions_profile_version_id_idx" ON "sj_publication_versions"("profile_version_id");

-- CreateIndex
CREATE INDEX "sj_publication_versions_taxonomy_item_id_idx" ON "sj_publication_versions"("taxonomy_item_id");

-- CreateIndex
CREATE INDEX "sj_publication_versions_last_edited_by_idx" ON "sj_publication_versions"("last_edited_by");

-- CreateIndex
CREATE INDEX "sj_publication_versions_submitted_by_idx" ON "sj_publication_versions"("submitted_by");

-- CreateIndex
CREATE INDEX "sj_publication_versions_approved_by_idx" ON "sj_publication_versions"("approved_by");

-- CreateIndex
CREATE UNIQUE INDEX "sj_publication_versions_publication_id_version_number_key" ON "sj_publication_versions"("publication_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "sj_media_assets_logical_object_key_key" ON "sj_media_assets"("logical_object_key");

-- CreateIndex
CREATE INDEX "sj_media_assets_owner_division_id_state_idx" ON "sj_media_assets"("owner_division_id", "state");

-- CreateIndex
CREATE INDEX "sj_media_assets_central_media_id_idx" ON "sj_media_assets"("central_media_id");

-- CreateIndex
CREATE INDEX "sj_media_assets_sha256_idx" ON "sj_media_assets"("sha256");

-- CreateIndex
CREATE INDEX "sj_media_assets_created_by_idx" ON "sj_media_assets"("created_by");

-- CreateIndex
CREATE INDEX "sj_publication_version_media_media_asset_id_idx" ON "sj_publication_version_media"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "sj_publication_version_media_publication_version_id_media_a_key" ON "sj_publication_version_media"("publication_version_id", "media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "sj_publication_version_media_publication_version_id_sort_or_key" ON "sj_publication_version_media"("publication_version_id", "sort_order");

-- CreateIndex
CREATE INDEX "sj_publication_reviews_publication_id_created_at_idx" ON "sj_publication_reviews"("publication_id", "created_at");

-- CreateIndex
CREATE INDEX "sj_publication_reviews_publication_version_id_idx" ON "sj_publication_reviews"("publication_version_id");

-- CreateIndex
CREATE INDEX "sj_publication_reviews_reviewer_id_created_at_idx" ON "sj_publication_reviews"("reviewer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sj_sync_outbox_event_id_key" ON "sj_sync_outbox"("event_id");

-- CreateIndex
CREATE INDEX "sj_sync_outbox_state_available_at_priority_idx" ON "sj_sync_outbox"("state", "available_at", "priority");

-- CreateIndex
CREATE INDEX "sj_sync_outbox_aggregate_id_aggregate_version_idx" ON "sj_sync_outbox"("aggregate_id", "aggregate_version");

-- CreateIndex
CREATE UNIQUE INDEX "sj_sync_outbox_aggregate_id_aggregate_version_event_type_key" ON "sj_sync_outbox"("aggregate_id", "aggregate_version", "event_type");

-- CreateIndex
CREATE INDEX "sj_sync_attempts_outbox_id_started_at_idx" ON "sj_sync_attempts"("outbox_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "sj_sync_attempts_outbox_id_attempt_number_key" ON "sj_sync_attempts"("outbox_id", "attempt_number");

-- CreateIndex
CREATE INDEX "sj_reconciliation_runs_state_started_at_idx" ON "sj_reconciliation_runs"("state", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "sj_taxonomy_versions_version_key" ON "sj_taxonomy_versions"("version");

-- CreateIndex
CREATE INDEX "sj_taxonomy_versions_is_active_idx" ON "sj_taxonomy_versions"("is_active");

-- CreateIndex
CREATE INDEX "sj_taxonomy_items_category_is_active_idx" ON "sj_taxonomy_items"("category", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "sj_taxonomy_items_taxonomy_version_code_key" ON "sj_taxonomy_items"("taxonomy_version", "code");

-- AddForeignKey
ALTER TABLE "sj_public_profiles" ADD CONSTRAINT "sj_public_profiles_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "sj_public_profile_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_public_profiles" ADD CONSTRAINT "sj_public_profiles_logo_media_id_fkey" FOREIGN KEY ("logo_media_id") REFERENCES "sj_media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_public_profiles" ADD CONSTRAINT "sj_public_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_public_profiles" ADD CONSTRAINT "sj_public_profiles_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_public_profile_versions" ADD CONSTRAINT "sj_public_profile_versions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "sj_public_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_public_profile_versions" ADD CONSTRAINT "sj_public_profile_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_public_profile_versions" ADD CONSTRAINT "sj_public_profile_versions_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_whatsapp_contacts" ADD CONSTRAINT "sj_whatsapp_contacts_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "sj_whatsapp_contact_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_whatsapp_contacts" ADD CONSTRAINT "sj_whatsapp_contacts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_whatsapp_contacts" ADD CONSTRAINT "sj_whatsapp_contacts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_whatsapp_contact_versions" ADD CONSTRAINT "sj_whatsapp_contact_versions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "sj_whatsapp_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_whatsapp_contact_versions" ADD CONSTRAINT "sj_whatsapp_contact_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_whatsapp_contact_versions" ADD CONSTRAINT "sj_whatsapp_contact_versions_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publications" ADD CONSTRAINT "sj_publications_source_collateral_id_fkey" FOREIGN KEY ("source_collateral_id") REFERENCES "debtor_collaterals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publications" ADD CONSTRAINT "sj_publications_owner_division_id_fkey" FOREIGN KEY ("owner_division_id") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publications" ADD CONSTRAINT "sj_publications_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "sj_publication_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publications" ADD CONSTRAINT "sj_publications_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "sj_publication_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publications" ADD CONSTRAINT "sj_publications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publications" ADD CONSTRAINT "sj_publications_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publication_versions" ADD CONSTRAINT "sj_publication_versions_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "sj_publications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publication_versions" ADD CONSTRAINT "sj_publication_versions_whatsapp_contact_version_id_fkey" FOREIGN KEY ("whatsapp_contact_version_id") REFERENCES "sj_whatsapp_contact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publication_versions" ADD CONSTRAINT "sj_publication_versions_profile_version_id_fkey" FOREIGN KEY ("profile_version_id") REFERENCES "sj_public_profile_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publication_versions" ADD CONSTRAINT "sj_publication_versions_last_edited_by_fkey" FOREIGN KEY ("last_edited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publication_versions" ADD CONSTRAINT "sj_publication_versions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publication_versions" ADD CONSTRAINT "sj_publication_versions_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publication_versions" ADD CONSTRAINT "sj_publication_versions_taxonomy_item_id_fkey" FOREIGN KEY ("taxonomy_item_id") REFERENCES "sj_taxonomy_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_land_details" ADD CONSTRAINT "sj_land_details_publication_version_id_fkey" FOREIGN KEY ("publication_version_id") REFERENCES "sj_publication_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_building_details" ADD CONSTRAINT "sj_building_details_publication_version_id_fkey" FOREIGN KEY ("publication_version_id") REFERENCES "sj_publication_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_machine_details" ADD CONSTRAINT "sj_machine_details_publication_version_id_fkey" FOREIGN KEY ("publication_version_id") REFERENCES "sj_publication_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_vehicle_details" ADD CONSTRAINT "sj_vehicle_details_publication_version_id_fkey" FOREIGN KEY ("publication_version_id") REFERENCES "sj_publication_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_media_assets" ADD CONSTRAINT "sj_media_assets_owner_division_id_fkey" FOREIGN KEY ("owner_division_id") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_media_assets" ADD CONSTRAINT "sj_media_assets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publication_version_media" ADD CONSTRAINT "sj_publication_version_media_publication_version_id_fkey" FOREIGN KEY ("publication_version_id") REFERENCES "sj_publication_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publication_version_media" ADD CONSTRAINT "sj_publication_version_media_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "sj_media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publication_reviews" ADD CONSTRAINT "sj_publication_reviews_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "sj_publications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publication_reviews" ADD CONSTRAINT "sj_publication_reviews_publication_version_id_fkey" FOREIGN KEY ("publication_version_id") REFERENCES "sj_publication_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_publication_reviews" ADD CONSTRAINT "sj_publication_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_sync_attempts" ADD CONSTRAINT "sj_sync_attempts_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "sj_sync_outbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sj_taxonomy_items" ADD CONSTRAINT "sj_taxonomy_items_taxonomy_version_fkey" FOREIGN KEY ("taxonomy_version") REFERENCES "sj_taxonomy_versions"("version") ON DELETE RESTRICT ON UPDATE CASCADE;
