-- Direct actor predicates are required for Prisma INSERT ... RETURNING because
-- id-based SECURITY DEFINER helpers cannot reliably observe the row while that
-- same INSERT statement is returning it. Keep those predicates, but bind them
-- to the same read permission used by the domain helper. This prevents a user
-- whose menu permission was removed from retaining row visibility merely
-- because they originally created or acted on the record.

DROP POLICY IF EXISTS digital_documents_read_scope ON public.digital_documents;
CREATE POLICY digital_documents_read_scope ON public.digital_documents
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      (
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
          created_by = public.ruwang_arsip_current_user_id()
          OR owner_user_id = public.ruwang_arsip_current_user_id()
        )
      )
      OR public.ruwang_arsip_can_select_digital_document(id)
    )
  );

DROP POLICY IF EXISTS digital_document_access_requests_read
  ON public.digital_document_access_requests;
CREATE POLICY digital_document_access_requests_read
  ON public.digital_document_access_requests
  FOR SELECT USING (
    (
      public.ruwang_arsip_has_menu_permission(
        ARRAY[
          '/dashboard/arsip-digital/disposisi/pengajuan',
          '/dashboard/arsip-digital/disposisi/permintaan',
          '/dashboard/arsip-digital/disposisi/historis'
        ]::text[],
        'read'
      )
      AND public.ruwang_arsip_current_user_id() IN (
        requester_id,
        owner_id,
        acted_by
      )
    )
    OR public.ruwang_arsip_can_read_access_request(id)
  );

DROP POLICY IF EXISTS digital_document_loans_read
  ON public.digital_document_loans;
CREATE POLICY digital_document_loans_read
  ON public.digital_document_loans
  FOR SELECT USING (
    (
      public.ruwang_arsip_has_menu_permission(
        ARRAY[
          '/dashboard/arsip-digital/peminjaman/request',
          '/dashboard/arsip-digital/peminjaman/accept',
          '/dashboard/arsip-digital/peminjaman/laporan',
          '/dashboard/arsip-digital/historis/peminjaman'
        ]::text[],
        'read'
      )
      AND public.ruwang_arsip_current_user_id() IN (
        borrower_id,
        approved_by,
        handed_over_by,
        returned_by
      )
    )
    OR public.ruwang_arsip_can_read_document_loan(id)
  );

DROP POLICY IF EXISTS incoming_mails_read ON public.incoming_mails;
CREATE POLICY incoming_mails_read ON public.incoming_mails
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      (
        created_by = public.ruwang_arsip_current_user_id()
        AND public.ruwang_arsip_has_menu_permission(
          ARRAY['/dashboard/manajemen-surat/kelola-surat/input-surat-masuk']::text[],
          'read'
        )
      )
      OR public.ruwang_arsip_can_read_incoming_mail(id)
    )
  );

DROP POLICY IF EXISTS outgoing_mails_read ON public.outgoing_mails;
CREATE POLICY outgoing_mails_read ON public.outgoing_mails
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      (
        created_by = public.ruwang_arsip_current_user_id()
        AND public.ruwang_arsip_has_menu_permission(
          ARRAY['/dashboard/manajemen-surat/kelola-surat/input-surat-keluar']::text[],
          'read'
        )
      )
      OR public.ruwang_arsip_can_read_outgoing_mail(id)
    )
  );

DROP POLICY IF EXISTS memorandums_read ON public.memorandums;
CREATE POLICY memorandums_read ON public.memorandums
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      (
        created_by = public.ruwang_arsip_current_user_id()
        AND public.ruwang_arsip_has_menu_permission(
          ARRAY['/dashboard/manajemen-surat/kelola-surat/input-memorandum']::text[],
          'read'
        )
      )
      OR public.ruwang_arsip_can_read_memorandum(id)
    )
  );

DROP POLICY IF EXISTS debtor_import_jobs_read ON public.debtor_import_jobs;
CREATE POLICY debtor_import_jobs_read ON public.debtor_import_jobs
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      (
        created_by = public.ruwang_arsip_current_user_id()
        AND public.ruwang_arsip_has_menu_permission(
          ARRAY[
            '/dashboard/informasi-debitur/admin/upload-slik',
            '/dashboard/informasi-debitur/admin/monitoring-import',
            '/dashboard/informasi-debitur/admin/upload-ideb'
          ]::text[],
          'read'
        )
      )
      OR public.ruwang_arsip_can_read_import_job(id)
    )
  );
