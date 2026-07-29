-- RLS helpers intentionally run as a dedicated NOLOGIN policy role. The role
-- can only read application tables and exists so FORCE ROW LEVEL SECURITY does
-- not create recursive parent/child policy evaluation.
DO $bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_policy') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper
    ) THEN
      RAISE EXCEPTION
        'Role ruwang_arsip_policy belum diprovisikan oleh administrator database';
    END IF;
    CREATE ROLE ruwang_arsip_policy
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  END IF;
END
$bootstrap$;

GRANT USAGE, CREATE ON SCHEMA public TO ruwang_arsip_policy;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ruwang_arsip_policy;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_current_access_purpose()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(current_setting('app.access_purpose', true), '')
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_read_digital_document_core(
  target_document_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.digital_documents document
    WHERE document.id = target_document_id
      AND document.deleted_at IS NULL
      AND public.ruwang_arsip_has_menu_permission(
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
        document.created_by = public.ruwang_arsip_current_user_id()
        OR document.owner_user_id = public.ruwang_arsip_current_user_id()
        OR EXISTS (
          SELECT 1
          FROM public.digital_document_related_users related_user
          WHERE related_user.document_id = document.id
            AND related_user.user_id = public.ruwang_arsip_current_user_id()
        )
        OR EXISTS (
          SELECT 1
          FROM public.digital_document_access_requests access_request
          WHERE access_request.document_id = document.id
            AND access_request.requester_id = public.ruwang_arsip_current_user_id()
            AND access_request.status::text = 'APPROVED'
            AND access_request.expires_at::date >= CURRENT_DATE
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
            (document.access_level::text <> 'RESTRICT' AND NOT document.is_restricted)
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
          AND document.owner_division_id = public.ruwang_arsip_current_user_division_id()
          AND (
            (document.access_level::text <> 'RESTRICT' AND NOT document.is_restricted)
            OR public.ruwang_arsip_current_user_can_access_restricted()
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_select_digital_document(
  target_document_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    public.ruwang_arsip_can_read_digital_document_core(target_document_id)
    OR (
      public.ruwang_arsip_current_access_purpose() = 'digital_document_requestable'
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY['/dashboard/arsip-digital/disposisi/pengajuan']::text[],
        'read'
      )
      AND EXISTS (
        SELECT 1
        FROM public.digital_documents document
        WHERE document.id = target_document_id
          AND document.deleted_at IS NULL
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_manage_digital_document_id(
  target_document_id text,
  capability text DEFAULT 'update'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.digital_documents document
    WHERE document.id = target_document_id
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY['/dashboard/arsip-digital/ruang-arsip/list-dokumen']::text[],
        capability
      )
      AND (
        document.created_by = public.ruwang_arsip_current_user_id()
        OR document.owner_user_id = public.ruwang_arsip_current_user_id()
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
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_read_access_request(
  target_request_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.digital_document_access_requests request
    JOIN public.digital_documents document ON document.id = request.document_id
    WHERE request.id = target_request_id
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY[
          '/dashboard/arsip-digital/disposisi/pengajuan',
          '/dashboard/arsip-digital/disposisi/permintaan',
          '/dashboard/arsip-digital/disposisi/historis'
        ]::text[],
        'read'
      )
      AND (
        request.requester_id = public.ruwang_arsip_current_user_id()
        OR request.owner_id = public.ruwang_arsip_current_user_id()
        OR request.acted_by = public.ruwang_arsip_current_user_id()
        OR public.ruwang_arsip_can_read_digital_document_core(request.document_id)
        OR (
          request.status::text = 'PENDING'
          AND public.ruwang_arsip_has_menu_permission(
            ARRAY['/dashboard/arsip-digital/disposisi/permintaan']::text[],
            'read'
          )
          AND (
            public.ruwang_arsip_has_menu_feature(
              ARRAY['/dashboard/arsip-digital/disposisi/permintaan']::text[],
              'approve'
            )
            OR public.ruwang_arsip_has_menu_feature(
              ARRAY['/dashboard/arsip-digital/disposisi/permintaan']::text[],
              'reject'
            )
          )
          AND (
            (document.access_level::text <> 'RESTRICT' AND NOT document.is_restricted)
            OR public.ruwang_arsip_current_user_can_access_restricted()
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_update_access_request(
  target_request_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.digital_document_access_requests request
    JOIN public.digital_documents document ON document.id = request.document_id
    WHERE request.id = target_request_id
      AND request.requester_id <> public.ruwang_arsip_current_user_id()
      AND request.status::text IN ('PENDING', 'APPROVED')
      AND (
        (
          request.status::text = 'PENDING'
          AND public.ruwang_arsip_has_menu_permission(
            ARRAY['/dashboard/arsip-digital/disposisi/permintaan']::text[],
            'update'
          )
          AND (
            (
              request.owner_id = public.ruwang_arsip_current_user_id()
              AND public.ruwang_arsip_can_read_digital_document_core(request.document_id)
            )
            OR (
              (
                public.ruwang_arsip_has_menu_feature(
                  ARRAY['/dashboard/arsip-digital/disposisi/permintaan']::text[],
                  'approve'
                )
                OR public.ruwang_arsip_has_menu_feature(
                  ARRAY['/dashboard/arsip-digital/disposisi/permintaan']::text[],
                  'reject'
                )
              )
              AND (
                (document.access_level::text <> 'RESTRICT' AND NOT document.is_restricted)
                OR public.ruwang_arsip_current_user_can_access_restricted()
              )
            )
          )
        )
        OR (
          request.status::text = 'APPROVED'
          AND public.ruwang_arsip_has_menu_permission(
            ARRAY['/dashboard/arsip-digital/disposisi/historis']::text[],
            'update'
          )
          AND public.ruwang_arsip_has_menu_feature(
            ARRAY['/dashboard/arsip-digital/disposisi/historis']::text[],
            'revoke'
          )
          AND public.ruwang_arsip_can_read_digital_document_core(request.document_id)
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_read_document_loan(
  target_loan_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.digital_document_loans loan
    JOIN public.digital_documents document ON document.id = loan.document_id
    WHERE loan.id = target_loan_id
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY[
          '/dashboard/arsip-digital/peminjaman/request',
          '/dashboard/arsip-digital/peminjaman/accept',
          '/dashboard/arsip-digital/peminjaman/laporan',
          '/dashboard/arsip-digital/historis/peminjaman'
        ]::text[],
        'read'
      )
      AND (
        loan.borrower_id = public.ruwang_arsip_current_user_id()
        OR loan.approved_by = public.ruwang_arsip_current_user_id()
        OR loan.rejected_by = public.ruwang_arsip_current_user_id()
        OR loan.handed_over_by = public.ruwang_arsip_current_user_id()
        OR loan.returned_by = public.ruwang_arsip_current_user_id()
        OR public.ruwang_arsip_can_read_digital_document_core(loan.document_id)
        OR (
          public.ruwang_arsip_has_menu_permission(
            ARRAY['/dashboard/arsip-digital/peminjaman/accept']::text[],
            'read'
          )
          AND (
            (loan.status::text = 'PENDING' AND (
              public.ruwang_arsip_has_menu_feature(ARRAY['/dashboard/arsip-digital/peminjaman/accept']::text[], 'approve')
              OR public.ruwang_arsip_has_menu_feature(ARRAY['/dashboard/arsip-digital/peminjaman/accept']::text[], 'reject')
            ))
            OR (loan.status::text = 'APPROVED' AND public.ruwang_arsip_has_menu_feature(ARRAY['/dashboard/arsip-digital/peminjaman/accept']::text[], 'handover'))
            OR (loan.status::text IN ('HANDED_OVER', 'BORROWED') AND public.ruwang_arsip_has_menu_feature(ARRAY['/dashboard/arsip-digital/peminjaman/accept']::text[], 'return'))
          )
          AND (
            (document.access_level::text <> 'RESTRICT' AND NOT document.is_restricted)
            OR public.ruwang_arsip_current_user_can_access_restricted()
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_update_document_loan(
  target_loan_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.digital_document_loans loan
    JOIN public.digital_documents document ON document.id = loan.document_id
    WHERE loan.id = target_loan_id
      AND loan.borrower_id <> public.ruwang_arsip_current_user_id()
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY['/dashboard/arsip-digital/peminjaman/accept']::text[],
        'update'
      )
      AND (
        (loan.status::text = 'PENDING' AND (
          public.ruwang_arsip_has_menu_feature(ARRAY['/dashboard/arsip-digital/peminjaman/accept']::text[], 'approve')
          OR public.ruwang_arsip_has_menu_feature(ARRAY['/dashboard/arsip-digital/peminjaman/accept']::text[], 'reject')
        ))
        OR (loan.status::text = 'APPROVED' AND public.ruwang_arsip_has_menu_feature(ARRAY['/dashboard/arsip-digital/peminjaman/accept']::text[], 'handover'))
        OR (loan.status::text IN ('HANDED_OVER', 'BORROWED') AND public.ruwang_arsip_has_menu_feature(ARRAY['/dashboard/arsip-digital/peminjaman/accept']::text[], 'return'))
      )
      AND (
        (document.access_level::text <> 'RESTRICT' AND NOT document.is_restricted)
        OR public.ruwang_arsip_current_user_can_access_restricted()
      )
  )
$$;

ALTER FUNCTION public.ruwang_arsip_can_read_digital_document_core(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_select_digital_document(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_manage_digital_document_id(text, text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_read_access_request(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_update_access_request(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_read_document_loan(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_update_document_loan(text) OWNER TO ruwang_arsip_policy;

REVOKE ALL ON FUNCTION public.ruwang_arsip_can_read_digital_document_core(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_select_digital_document(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_manage_digital_document_id(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_read_access_request(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_update_access_request(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_read_document_loan(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_update_document_loan(text) FROM PUBLIC;

DO $grant_app$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_app') THEN
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_read_digital_document_core(text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_select_digital_document(text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_manage_digital_document_id(text, text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_read_access_request(text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_update_access_request(text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_read_document_loan(text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_update_document_loan(text) TO ruwang_arsip_app;
  END IF;
END
$grant_app$;

DROP POLICY IF EXISTS digital_documents_read_scope ON public.digital_documents;
CREATE POLICY digital_documents_read_scope ON public.digital_documents
  FOR SELECT USING (public.ruwang_arsip_can_select_digital_document(id));

ALTER TABLE public.digital_document_related_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_document_related_users FORCE ROW LEVEL SECURITY;
CREATE POLICY digital_document_related_users_read ON public.digital_document_related_users
  FOR SELECT USING (
    user_id = public.ruwang_arsip_current_user_id()
    OR public.ruwang_arsip_can_read_digital_document_core(document_id)
  );
CREATE POLICY digital_document_related_users_write ON public.digital_document_related_users
  FOR ALL USING (public.ruwang_arsip_can_manage_digital_document_id(document_id))
  WITH CHECK (public.ruwang_arsip_can_manage_digital_document_id(document_id));

ALTER TABLE public.document_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_files FORCE ROW LEVEL SECURITY;
CREATE POLICY document_files_read ON public.document_files
  FOR SELECT USING (public.ruwang_arsip_can_read_digital_document_core(document_id));
CREATE POLICY document_files_write ON public.document_files
  FOR ALL USING (public.ruwang_arsip_can_manage_digital_document_id(document_id))
  WITH CHECK (
    public.ruwang_arsip_can_manage_digital_document_id(document_id)
    AND (uploaded_by IS NULL OR uploaded_by = public.ruwang_arsip_current_user_id())
  );

ALTER TABLE public.digital_document_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_document_access_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY digital_document_access_requests_read ON public.digital_document_access_requests
  FOR SELECT USING (public.ruwang_arsip_can_read_access_request(id));
CREATE POLICY digital_document_access_requests_create ON public.digital_document_access_requests
  FOR INSERT WITH CHECK (
    public.ruwang_arsip_current_access_purpose() = 'digital_document_requestable'
    AND requester_id = public.ruwang_arsip_current_user_id()
    AND public.ruwang_arsip_has_menu_permission(
      ARRAY['/dashboard/arsip-digital/disposisi/pengajuan']::text[],
      'create'
    )
    AND NOT public.ruwang_arsip_can_read_digital_document_core(document_id)
    AND EXISTS (
      SELECT 1 FROM public.digital_documents document
      WHERE document.id = document_id
        AND document.deleted_at IS NULL
        AND owner_id = COALESCE(document.owner_user_id, document.created_by)
    )
  );
CREATE POLICY digital_document_access_requests_update ON public.digital_document_access_requests
  FOR UPDATE USING (public.ruwang_arsip_can_update_access_request(id))
  WITH CHECK (
    requester_id <> public.ruwang_arsip_current_user_id()
    AND public.ruwang_arsip_can_read_access_request(id)
  );

ALTER TABLE public.digital_document_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_document_loans FORCE ROW LEVEL SECURITY;
CREATE POLICY digital_document_loans_read ON public.digital_document_loans
  FOR SELECT USING (public.ruwang_arsip_can_read_document_loan(id));
CREATE POLICY digital_document_loans_create ON public.digital_document_loans
  FOR INSERT WITH CHECK (
    borrower_id = public.ruwang_arsip_current_user_id()
    AND public.ruwang_arsip_has_menu_permission(
      ARRAY['/dashboard/arsip-digital/peminjaman/request']::text[],
      'create'
    )
    AND public.ruwang_arsip_can_read_digital_document_core(document_id)
  );
CREATE POLICY digital_document_loans_update ON public.digital_document_loans
  FOR UPDATE USING (public.ruwang_arsip_can_update_document_loan(id))
  WITH CHECK (public.ruwang_arsip_can_read_document_loan(id));

ALTER TABLE public.storage_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_activity_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY storage_activity_logs_read ON public.storage_activity_logs
  FOR SELECT USING (public.ruwang_arsip_can_read_digital_document_core(document_id));
CREATE POLICY storage_activity_logs_create ON public.storage_activity_logs
  FOR INSERT WITH CHECK (
    (actor_id IS NULL OR actor_id = public.ruwang_arsip_current_user_id())
    AND (
      public.ruwang_arsip_can_read_digital_document_core(document_id)
      OR (
        public.ruwang_arsip_current_access_purpose() = 'digital_document_requestable'
        AND public.ruwang_arsip_can_select_digital_document(document_id)
      )
    )
  );
