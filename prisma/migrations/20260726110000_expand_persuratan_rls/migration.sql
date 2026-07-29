GRANT SELECT ON ALL TABLES IN SCHEMA public TO ruwang_arsip_policy;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_read_incoming_mail(target_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.incoming_mails mail
    WHERE mail.id = target_id
      AND mail.deleted_at IS NULL
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY['/dashboard/manajemen-surat/kelola-surat/input-surat-masuk']::text[],
        'read'
      )
      AND (
        mail.created_by = public.ruwang_arsip_current_user_id()
        OR public.ruwang_arsip_has_menu_feature(
          ARRAY[
            '/dashboard/manajemen-surat/kelola-surat/input-surat-masuk',
            '/dashboard/manajemen-surat/kelola-surat/input-surat-keluar',
            '/dashboard/manajemen-surat/kelola-surat/input-memorandum',
            '/dashboard/manajemen-surat/laporan',
            '/dashboard/manajemen-surat/cetak-dokumen'
          ]::text[],
          'manage_all'
        )
        OR EXISTS (
          SELECT 1 FROM public.incoming_mail_dispositions disposition
          WHERE disposition.incoming_mails_id = mail.id
            AND public.ruwang_arsip_current_user_id() IN (disposition.sender_id, disposition.receiver_id)
        )
        OR (
          public.ruwang_arsip_has_menu_feature(
            ARRAY[
              '/dashboard/manajemen-surat/kelola-surat/input-surat-masuk',
              '/dashboard/manajemen-surat/kelola-surat/input-surat-keluar',
              '/dashboard/manajemen-surat/kelola-surat/input-memorandum',
              '/dashboard/manajemen-surat/laporan',
              '/dashboard/manajemen-surat/cetak-dokumen'
            ]::text[],
            'view_division'
          )
          AND EXISTS (
            SELECT 1
            FROM public.incoming_mail_target_divisions target
            WHERE target.incoming_mails_id = mail.id
              AND (
                target.division_id = public.ruwang_arsip_current_user_division_id()
                OR target.manager_id = public.ruwang_arsip_current_user_id()
              )
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_manage_incoming_mail(
  target_id text,
  capability text DEFAULT 'update'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.incoming_mails mail
    WHERE mail.id = target_id
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY['/dashboard/manajemen-surat/kelola-surat/input-surat-masuk']::text[],
        capability
      )
      AND (
        mail.created_by = public.ruwang_arsip_current_user_id()
        OR public.ruwang_arsip_has_menu_feature(
          ARRAY[
            '/dashboard/manajemen-surat/kelola-surat/input-surat-masuk',
            '/dashboard/manajemen-surat/kelola-surat/input-surat-keluar',
            '/dashboard/manajemen-surat/kelola-surat/input-memorandum',
            '/dashboard/manajemen-surat/laporan',
            '/dashboard/manajemen-surat/cetak-dokumen'
          ]::text[],
          'manage_all'
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_workflow_incoming_mail(target_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    public.ruwang_arsip_has_menu_permission(
      ARRAY['/dashboard/manajemen-surat/kelola-surat/input-surat-masuk']::text[],
      'update'
    )
    AND EXISTS (
      SELECT 1 FROM public.incoming_mail_dispositions disposition
      WHERE disposition.incoming_mails_id = target_id
        AND disposition.receiver_id = public.ruwang_arsip_current_user_id()
        AND NOT disposition.is_complete
    )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_read_outgoing_mail(target_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.outgoing_mails mail
    LEFT JOIN public.users creator ON creator.id = mail.created_by
    WHERE mail.id = target_id
      AND mail.deleted_at IS NULL
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY['/dashboard/manajemen-surat/kelola-surat/input-surat-keluar']::text[],
        'read'
      )
      AND (
        mail.created_by = public.ruwang_arsip_current_user_id()
        OR public.ruwang_arsip_has_menu_feature(
          ARRAY[
            '/dashboard/manajemen-surat/kelola-surat/input-surat-masuk',
            '/dashboard/manajemen-surat/kelola-surat/input-surat-keluar',
            '/dashboard/manajemen-surat/kelola-surat/input-memorandum',
            '/dashboard/manajemen-surat/laporan',
            '/dashboard/manajemen-surat/cetak-dokumen'
          ]::text[],
          'manage_all'
        )
        OR (
          public.ruwang_arsip_has_menu_feature(
            ARRAY[
              '/dashboard/manajemen-surat/kelola-surat/input-surat-masuk',
              '/dashboard/manajemen-surat/kelola-surat/input-surat-keluar',
              '/dashboard/manajemen-surat/kelola-surat/input-memorandum',
              '/dashboard/manajemen-surat/laporan',
              '/dashboard/manajemen-surat/cetak-dokumen'
            ]::text[],
            'view_division'
          )
          AND creator.division_id = public.ruwang_arsip_current_user_division_id()
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_manage_outgoing_mail(
  target_id text,
  capability text DEFAULT 'update'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.outgoing_mails mail
    WHERE mail.id = target_id
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY['/dashboard/manajemen-surat/kelola-surat/input-surat-keluar']::text[],
        capability
      )
      AND (
        mail.created_by = public.ruwang_arsip_current_user_id()
        OR public.ruwang_arsip_has_menu_feature(
          ARRAY[
            '/dashboard/manajemen-surat/kelola-surat/input-surat-masuk',
            '/dashboard/manajemen-surat/kelola-surat/input-surat-keluar',
            '/dashboard/manajemen-surat/kelola-surat/input-memorandum',
            '/dashboard/manajemen-surat/laporan',
            '/dashboard/manajemen-surat/cetak-dokumen'
          ]::text[],
          'manage_all'
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_read_memorandum(target_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memorandums memo
    WHERE memo.id = target_id
      AND memo.deleted_at IS NULL
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY['/dashboard/manajemen-surat/kelola-surat/input-memorandum']::text[],
        'read'
      )
      AND (
        memo.created_by = public.ruwang_arsip_current_user_id()
        OR public.ruwang_arsip_has_menu_feature(
          ARRAY[
            '/dashboard/manajemen-surat/kelola-surat/input-surat-masuk',
            '/dashboard/manajemen-surat/kelola-surat/input-surat-keluar',
            '/dashboard/manajemen-surat/kelola-surat/input-memorandum',
            '/dashboard/manajemen-surat/laporan',
            '/dashboard/manajemen-surat/cetak-dokumen'
          ]::text[],
          'manage_all'
        )
        OR EXISTS (
          SELECT 1 FROM public.memorandum_dispositions disposition
          WHERE disposition.memorandums_id = memo.id
            AND public.ruwang_arsip_current_user_id() IN (disposition.sender_id, disposition.receiver_id)
        )
        OR (
          public.ruwang_arsip_has_menu_feature(
            ARRAY[
              '/dashboard/manajemen-surat/kelola-surat/input-surat-masuk',
              '/dashboard/manajemen-surat/kelola-surat/input-surat-keluar',
              '/dashboard/manajemen-surat/kelola-surat/input-memorandum',
              '/dashboard/manajemen-surat/laporan',
              '/dashboard/manajemen-surat/cetak-dokumen'
            ]::text[],
            'view_division'
          )
          AND (
            memo.origin_division_id = public.ruwang_arsip_current_user_division_id()
            OR EXISTS (
              SELECT 1 FROM public.memorandum_target_divisions target
              WHERE target.memorandums_id = memo.id
                AND (
                  target.division_id = public.ruwang_arsip_current_user_division_id()
                  OR target.manager_id = public.ruwang_arsip_current_user_id()
                )
            )
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_manage_memorandum(
  target_id text,
  capability text DEFAULT 'update'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memorandums memo
    WHERE memo.id = target_id
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY['/dashboard/manajemen-surat/kelola-surat/input-memorandum']::text[],
        capability
      )
      AND (
        memo.created_by = public.ruwang_arsip_current_user_id()
        OR public.ruwang_arsip_has_menu_feature(
          ARRAY[
            '/dashboard/manajemen-surat/kelola-surat/input-surat-masuk',
            '/dashboard/manajemen-surat/kelola-surat/input-surat-keluar',
            '/dashboard/manajemen-surat/kelola-surat/input-memorandum',
            '/dashboard/manajemen-surat/laporan',
            '/dashboard/manajemen-surat/cetak-dokumen'
          ]::text[],
          'manage_all'
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_workflow_memorandum(target_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    public.ruwang_arsip_has_menu_permission(
      ARRAY['/dashboard/manajemen-surat/kelola-surat/input-memorandum']::text[],
      'update'
    )
    AND EXISTS (
      SELECT 1 FROM public.memorandum_dispositions disposition
      WHERE disposition.memorandums_id = target_id
        AND disposition.receiver_id = public.ruwang_arsip_current_user_id()
        AND NOT disposition.is_complete
    )
$$;

ALTER FUNCTION public.ruwang_arsip_can_read_incoming_mail(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_manage_incoming_mail(text, text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_workflow_incoming_mail(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_read_outgoing_mail(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_manage_outgoing_mail(text, text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_read_memorandum(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_manage_memorandum(text, text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_workflow_memorandum(text) OWNER TO ruwang_arsip_policy;

REVOKE ALL ON FUNCTION public.ruwang_arsip_can_read_incoming_mail(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_manage_incoming_mail(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_workflow_incoming_mail(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_read_outgoing_mail(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_manage_outgoing_mail(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_read_memorandum(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_manage_memorandum(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_workflow_memorandum(text) FROM PUBLIC;

DO $grant_app$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_app') THEN
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_read_incoming_mail(text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_manage_incoming_mail(text, text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_workflow_incoming_mail(text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_read_outgoing_mail(text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_manage_outgoing_mail(text, text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_read_memorandum(text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_manage_memorandum(text, text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_workflow_memorandum(text) TO ruwang_arsip_app;
  END IF;
END
$grant_app$;

ALTER TABLE public.incoming_mails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incoming_mails FORCE ROW LEVEL SECURITY;
CREATE POLICY incoming_mails_read ON public.incoming_mails
  FOR SELECT USING (public.ruwang_arsip_can_read_incoming_mail(id));
CREATE POLICY incoming_mails_create ON public.incoming_mails
  FOR INSERT WITH CHECK (
    created_by = public.ruwang_arsip_current_user_id()
    AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/manajemen-surat/kelola-surat/input-surat-masuk']::text[], 'create')
  );
CREATE POLICY incoming_mails_update ON public.incoming_mails
  FOR UPDATE USING (
    public.ruwang_arsip_can_manage_incoming_mail(id)
    OR public.ruwang_arsip_can_workflow_incoming_mail(id)
  )
  WITH CHECK (
    created_by = public.ruwang_arsip_current_user_id()
    OR public.ruwang_arsip_can_manage_incoming_mail(id)
    OR public.ruwang_arsip_can_workflow_incoming_mail(id)
  );
CREATE POLICY incoming_mails_delete ON public.incoming_mails
  FOR DELETE USING (public.ruwang_arsip_can_manage_incoming_mail(id, 'delete'));

ALTER TABLE public.incoming_mail_target_divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incoming_mail_target_divisions FORCE ROW LEVEL SECURITY;
CREATE POLICY incoming_mail_targets_read ON public.incoming_mail_target_divisions
  FOR SELECT USING (public.ruwang_arsip_can_read_incoming_mail(incoming_mails_id));
CREATE POLICY incoming_mail_targets_write ON public.incoming_mail_target_divisions
  FOR ALL USING (public.ruwang_arsip_can_manage_incoming_mail(incoming_mails_id))
  WITH CHECK (public.ruwang_arsip_can_manage_incoming_mail(incoming_mails_id));

ALTER TABLE public.incoming_mail_dispositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incoming_mail_dispositions FORCE ROW LEVEL SECURITY;
CREATE POLICY incoming_mail_dispositions_read ON public.incoming_mail_dispositions
  FOR SELECT USING (public.ruwang_arsip_can_read_incoming_mail(incoming_mails_id));
CREATE POLICY incoming_mail_dispositions_create ON public.incoming_mail_dispositions
  FOR INSERT WITH CHECK (
    sender_id = public.ruwang_arsip_current_user_id()
    OR public.ruwang_arsip_can_manage_incoming_mail(incoming_mails_id)
  );
CREATE POLICY incoming_mail_dispositions_update ON public.incoming_mail_dispositions
  FOR UPDATE USING (
    receiver_id = public.ruwang_arsip_current_user_id()
    OR public.ruwang_arsip_can_manage_incoming_mail(incoming_mails_id)
  )
  WITH CHECK (
    receiver_id = public.ruwang_arsip_current_user_id()
    OR public.ruwang_arsip_can_manage_incoming_mail(incoming_mails_id)
  );
CREATE POLICY incoming_mail_dispositions_delete ON public.incoming_mail_dispositions
  FOR DELETE USING (public.ruwang_arsip_can_manage_incoming_mail(incoming_mails_id, 'delete'));

ALTER TABLE public.outgoing_mails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outgoing_mails FORCE ROW LEVEL SECURITY;
CREATE POLICY outgoing_mails_read ON public.outgoing_mails
  FOR SELECT USING (public.ruwang_arsip_can_read_outgoing_mail(id));
CREATE POLICY outgoing_mails_create ON public.outgoing_mails
  FOR INSERT WITH CHECK (
    created_by = public.ruwang_arsip_current_user_id()
    AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/manajemen-surat/kelola-surat/input-surat-keluar']::text[], 'create')
  );
CREATE POLICY outgoing_mails_update ON public.outgoing_mails
  FOR UPDATE USING (public.ruwang_arsip_can_manage_outgoing_mail(id))
  WITH CHECK (created_by = public.ruwang_arsip_current_user_id() OR public.ruwang_arsip_can_manage_outgoing_mail(id));
CREATE POLICY outgoing_mails_delete ON public.outgoing_mails
  FOR DELETE USING (public.ruwang_arsip_can_manage_outgoing_mail(id, 'delete'));

ALTER TABLE public.memorandums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memorandums FORCE ROW LEVEL SECURITY;
CREATE POLICY memorandums_read ON public.memorandums
  FOR SELECT USING (public.ruwang_arsip_can_read_memorandum(id));
CREATE POLICY memorandums_create ON public.memorandums
  FOR INSERT WITH CHECK (
    created_by = public.ruwang_arsip_current_user_id()
    AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/manajemen-surat/kelola-surat/input-memorandum']::text[], 'create')
  );
CREATE POLICY memorandums_update ON public.memorandums
  FOR UPDATE USING (
    public.ruwang_arsip_can_manage_memorandum(id)
    OR public.ruwang_arsip_can_workflow_memorandum(id)
  )
  WITH CHECK (
    created_by = public.ruwang_arsip_current_user_id()
    OR public.ruwang_arsip_can_manage_memorandum(id)
    OR public.ruwang_arsip_can_workflow_memorandum(id)
  );
CREATE POLICY memorandums_delete ON public.memorandums
  FOR DELETE USING (public.ruwang_arsip_can_manage_memorandum(id, 'delete'));

ALTER TABLE public.memorandum_target_divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memorandum_target_divisions FORCE ROW LEVEL SECURITY;
CREATE POLICY memorandum_targets_read ON public.memorandum_target_divisions
  FOR SELECT USING (public.ruwang_arsip_can_read_memorandum(memorandums_id));
CREATE POLICY memorandum_targets_write ON public.memorandum_target_divisions
  FOR ALL USING (public.ruwang_arsip_can_manage_memorandum(memorandums_id))
  WITH CHECK (public.ruwang_arsip_can_manage_memorandum(memorandums_id));

ALTER TABLE public.memorandum_dispositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memorandum_dispositions FORCE ROW LEVEL SECURITY;
CREATE POLICY memorandum_dispositions_read ON public.memorandum_dispositions
  FOR SELECT USING (public.ruwang_arsip_can_read_memorandum(memorandums_id));
CREATE POLICY memorandum_dispositions_create ON public.memorandum_dispositions
  FOR INSERT WITH CHECK (
    sender_id = public.ruwang_arsip_current_user_id()
    OR public.ruwang_arsip_can_manage_memorandum(memorandums_id)
  );
CREATE POLICY memorandum_dispositions_update ON public.memorandum_dispositions
  FOR UPDATE USING (
    receiver_id = public.ruwang_arsip_current_user_id()
    OR public.ruwang_arsip_can_manage_memorandum(memorandums_id)
  )
  WITH CHECK (
    receiver_id = public.ruwang_arsip_current_user_id()
    OR public.ruwang_arsip_can_manage_memorandum(memorandums_id)
  );
CREATE POLICY memorandum_dispositions_delete ON public.memorandum_dispositions
  FOR DELETE USING (public.ruwang_arsip_can_manage_memorandum(memorandums_id, 'delete'));
