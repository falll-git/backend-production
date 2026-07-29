DROP POLICY IF EXISTS "digital_documents_read_scope" ON "digital_documents";
DROP POLICY IF EXISTS "digital_documents_create_scope" ON "digital_documents";
DROP POLICY IF EXISTS "digital_documents_update_scope" ON "digital_documents";
DROP POLICY IF EXISTS "digital_documents_delete_scope" ON "digital_documents";

DROP FUNCTION IF EXISTS public.ruwang_arsip_can_manage_digital_document(text, text);
DROP FUNCTION IF EXISTS public.ruwang_arsip_can_read_digital_document(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.ruwang_arsip_current_user_can_access_restricted();
DROP FUNCTION IF EXISTS public.ruwang_arsip_current_user_division_id();
DROP FUNCTION IF EXISTS public.ruwang_arsip_has_menu_feature(text[], text);
DROP FUNCTION IF EXISTS public.ruwang_arsip_has_menu_permission(text[], text);

CREATE FUNCTION public.ruwang_arsip_has_menu_permission(
  menu_urls text[],
  capability text
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "users" app_user
    JOIN "role_menus" permission
      ON permission."role_id" = app_user."role_id"
    JOIN "menus" menu
      ON menu."id" = permission."menu_id"
    WHERE app_user."id" = public.ruwang_arsip_current_user_id()
      AND app_user."is_active" = true
      AND menu."url" = ANY(menu_urls)
      AND CASE lower(capability)
        WHEN 'create' THEN permission."can_create"
        WHEN 'update' THEN permission."can_update"
        WHEN 'delete' THEN permission."can_delete"
        ELSE permission."can_read"
      END
  )
$$;

CREATE FUNCTION public.ruwang_arsip_has_menu_feature(
  menu_urls text[],
  feature_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "users" app_user
    JOIN "role_menus" permission
      ON permission."role_id" = app_user."role_id"
    JOIN "menus" menu
      ON menu."id" = permission."menu_id"
    WHERE app_user."id" = public.ruwang_arsip_current_user_id()
      AND app_user."is_active" = true
      AND permission."can_read" = true
      AND menu."url" = ANY(menu_urls)
      AND feature_key = ANY(permission."features")
  )
$$;

CREATE FUNCTION public.ruwang_arsip_current_user_division_id()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT app_user."division_id"
  FROM "users" app_user
  WHERE app_user."id" = public.ruwang_arsip_current_user_id()
    AND app_user."is_active" = true
$$;

CREATE FUNCTION public.ruwang_arsip_current_user_can_access_restricted()
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE((
    SELECT app_user."can_access_restricted_documents"
    FROM "users" app_user
    WHERE app_user."id" = public.ruwang_arsip_current_user_id()
      AND app_user."is_active" = true
  ), false)
$$;

CREATE FUNCTION public.ruwang_arsip_can_read_digital_document(
  document_id text,
  document_created_by text,
  document_owner_user_id text,
  document_owner_division_id text,
  document_access_level text
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    public.ruwang_arsip_has_menu_permission(
      ARRAY[
        '/dashboard/arsip-digital/ruang-arsip/list-dokumen',
        '/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan',
        '/dashboard/arsip-digital/ruang-arsip/jatuh-tempo',
        '/dashboard/arsip-digital/peminjaman/request'
      ]::text[],
      'read'
    )
    AND (
      document_created_by = public.ruwang_arsip_current_user_id()
      OR document_owner_user_id = public.ruwang_arsip_current_user_id()
      OR EXISTS (
        SELECT 1
        FROM "digital_document_related_users" related_user
        WHERE related_user."document_id" = document_id
          AND related_user."user_id" = public.ruwang_arsip_current_user_id()
      )
      OR EXISTS (
        SELECT 1
        FROM "digital_document_access_requests" access_request
        WHERE access_request."document_id" = document_id
          AND access_request."requester_id" = public.ruwang_arsip_current_user_id()
          AND access_request."status"::text = 'APPROVED'
          AND access_request."expires_at" >= CURRENT_TIMESTAMP
      )
      OR (
        public.ruwang_arsip_has_menu_feature(
          ARRAY[
            '/dashboard/arsip-digital/ruang-arsip/list-dokumen',
            '/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan',
            '/dashboard/arsip-digital/ruang-arsip/jatuh-tempo',
            '/dashboard/arsip-digital/peminjaman/request'
          ]::text[],
          'manage_all'
        )
        AND (
          document_access_level <> 'RESTRICT'
          OR public.ruwang_arsip_current_user_can_access_restricted()
        )
      )
      OR (
        public.ruwang_arsip_has_menu_feature(
          ARRAY[
            '/dashboard/arsip-digital/ruang-arsip/list-dokumen',
            '/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan',
            '/dashboard/arsip-digital/ruang-arsip/jatuh-tempo',
            '/dashboard/arsip-digital/peminjaman/request'
          ]::text[],
          'view_division'
        )
        AND document_owner_division_id = public.ruwang_arsip_current_user_division_id()
        AND (
          document_access_level <> 'RESTRICT'
          OR public.ruwang_arsip_current_user_can_access_restricted()
        )
      )
    )
$$;

CREATE FUNCTION public.ruwang_arsip_can_manage_digital_document(
  document_created_by text,
  document_owner_user_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    public.ruwang_arsip_has_menu_permission(
      ARRAY['/dashboard/arsip-digital/ruang-arsip/list-dokumen']::text[],
      'update'
    )
    AND (
      document_created_by = public.ruwang_arsip_current_user_id()
      OR document_owner_user_id = public.ruwang_arsip_current_user_id()
      OR public.ruwang_arsip_has_menu_feature(
        ARRAY['/dashboard/arsip-digital/ruang-arsip/list-dokumen']::text[],
        'manage_all'
      )
    )
$$;

ALTER TABLE "digital_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "digital_documents" FORCE ROW LEVEL SECURITY;

CREATE POLICY "digital_documents_read_scope"
  ON "digital_documents"
  FOR SELECT
  USING (
    public.ruwang_arsip_can_read_digital_document(
      "id",
      "created_by",
      "owner_user_id",
      "owner_division_id",
      "access_level"::text
    )
  );

CREATE POLICY "digital_documents_create_scope"
  ON "digital_documents"
  FOR INSERT
  WITH CHECK (
    "created_by" = public.ruwang_arsip_current_user_id()
    AND public.ruwang_arsip_has_menu_permission(
      ARRAY['/dashboard/arsip-digital/input-dokumen']::text[],
      'create'
    )
    AND (
      "access_level"::text <> 'RESTRICT'
      OR public.ruwang_arsip_current_user_can_access_restricted()
    )
  );

CREATE POLICY "digital_documents_update_scope"
  ON "digital_documents"
  FOR UPDATE
  USING (
    public.ruwang_arsip_can_manage_digital_document(
      "created_by",
      "owner_user_id"
    )
  )
  WITH CHECK (
    public.ruwang_arsip_can_manage_digital_document(
      "created_by",
      "owner_user_id"
    )
    AND (
      "access_level"::text <> 'RESTRICT'
      OR public.ruwang_arsip_current_user_can_access_restricted()
    )
  );

CREATE POLICY "digital_documents_delete_scope"
  ON "digital_documents"
  FOR DELETE
  USING (
    public.ruwang_arsip_can_manage_digital_document(
      "created_by",
      "owner_user_id"
    )
    AND public.ruwang_arsip_has_menu_permission(
      ARRAY['/dashboard/arsip-digital/ruang-arsip/list-dokumen']::text[],
      'delete'
    )
  );
