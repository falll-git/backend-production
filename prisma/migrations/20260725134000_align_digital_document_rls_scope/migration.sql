DROP POLICY IF EXISTS "digital_documents_read_scope" ON "digital_documents";
DROP POLICY IF EXISTS "digital_documents_create_scope" ON "digital_documents";
DROP POLICY IF EXISTS "digital_documents_update_scope" ON "digital_documents";

DROP FUNCTION IF EXISTS public.ruwang_arsip_can_read_digital_document(
  text,
  text,
  text,
  text,
  text
);

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_manage_digital_document(
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
        ARRAY[
          '/dashboard/arsip-digital/input-dokumen',
          '/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan',
          '/dashboard/arsip-digital/ruang-arsip/list-dokumen',
          '/dashboard/arsip-digital/ruang-arsip/jatuh-tempo',
          '/dashboard/arsip-digital/disposisi/pengajuan',
          '/dashboard/arsip-digital/disposisi/permintaan',
          '/dashboard/arsip-digital/disposisi/historis',
          '/dashboard/arsip-digital/peminjaman/request',
          '/dashboard/arsip-digital/peminjaman/accept',
          '/dashboard/arsip-digital/peminjaman/laporan',
          '/dashboard/arsip-digital/historis/penyimpanan',
          '/dashboard/arsip-digital/historis/peminjaman',
          '/dashboard/arsip-digital/laporan'
        ]::text[],
        'manage_all'
      )
    )
$$;

CREATE FUNCTION public.ruwang_arsip_can_read_digital_document(
  document_id text,
  document_created_by text,
  document_owner_user_id text,
  document_owner_division_id text,
  document_access_level text,
  document_is_restricted boolean
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    public.ruwang_arsip_has_menu_permission(
      ARRAY[
        '/dashboard/arsip-digital/input-dokumen',
        '/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan',
        '/dashboard/arsip-digital/ruang-arsip/list-dokumen',
        '/dashboard/arsip-digital/ruang-arsip/jatuh-tempo',
        '/dashboard/arsip-digital/disposisi/pengajuan',
        '/dashboard/arsip-digital/disposisi/permintaan',
        '/dashboard/arsip-digital/disposisi/historis',
        '/dashboard/arsip-digital/peminjaman/request',
        '/dashboard/arsip-digital/peminjaman/accept',
        '/dashboard/arsip-digital/peminjaman/laporan',
        '/dashboard/arsip-digital/historis/penyimpanan',
        '/dashboard/arsip-digital/historis/peminjaman',
        '/dashboard/arsip-digital/laporan'
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
            '/dashboard/arsip-digital/input-dokumen',
            '/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan',
            '/dashboard/arsip-digital/ruang-arsip/list-dokumen',
            '/dashboard/arsip-digital/ruang-arsip/jatuh-tempo',
            '/dashboard/arsip-digital/disposisi/pengajuan',
            '/dashboard/arsip-digital/disposisi/permintaan',
            '/dashboard/arsip-digital/disposisi/historis',
            '/dashboard/arsip-digital/peminjaman/request',
            '/dashboard/arsip-digital/peminjaman/accept',
            '/dashboard/arsip-digital/peminjaman/laporan',
            '/dashboard/arsip-digital/historis/penyimpanan',
            '/dashboard/arsip-digital/historis/peminjaman',
            '/dashboard/arsip-digital/laporan'
          ]::text[],
          'manage_all'
        )
        AND (
          (document_access_level <> 'RESTRICT' AND NOT document_is_restricted)
          OR public.ruwang_arsip_current_user_can_access_restricted()
        )
      )
      OR (
        public.ruwang_arsip_has_menu_feature(
          ARRAY[
            '/dashboard/arsip-digital/input-dokumen',
            '/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan',
            '/dashboard/arsip-digital/ruang-arsip/list-dokumen',
            '/dashboard/arsip-digital/ruang-arsip/jatuh-tempo',
            '/dashboard/arsip-digital/disposisi/pengajuan',
            '/dashboard/arsip-digital/disposisi/permintaan',
            '/dashboard/arsip-digital/disposisi/historis',
            '/dashboard/arsip-digital/peminjaman/request',
            '/dashboard/arsip-digital/peminjaman/accept',
            '/dashboard/arsip-digital/peminjaman/laporan',
            '/dashboard/arsip-digital/historis/penyimpanan',
            '/dashboard/arsip-digital/historis/peminjaman',
            '/dashboard/arsip-digital/laporan'
          ]::text[],
          'view_division'
        )
        AND document_owner_division_id = public.ruwang_arsip_current_user_division_id()
        AND (
          (document_access_level <> 'RESTRICT' AND NOT document_is_restricted)
          OR public.ruwang_arsip_current_user_can_access_restricted()
        )
      )
    )
$$;

CREATE POLICY "digital_documents_read_scope"
  ON "digital_documents"
  FOR SELECT
  USING (
    public.ruwang_arsip_can_read_digital_document(
      "id",
      "created_by",
      "owner_user_id",
      "owner_division_id",
      "access_level"::text,
      "is_restricted"
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
      ("access_level"::text <> 'RESTRICT' AND NOT "is_restricted")
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
      ("access_level"::text <> 'RESTRICT' AND NOT "is_restricted")
      OR public.ruwang_arsip_current_user_can_access_restricted()
    )
  );
