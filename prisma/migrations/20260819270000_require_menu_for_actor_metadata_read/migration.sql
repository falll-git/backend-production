DROP POLICY IF EXISTS digital_document_related_users_read
  ON public.digital_document_related_users;
CREATE POLICY digital_document_related_users_read
  ON public.digital_document_related_users
  FOR SELECT
  USING (public.ruwang_arsip_can_read_digital_document_core(document_id));

DROP POLICY IF EXISTS debtor_ideb_uploads_read
  ON public.debtor_ideb_uploads;
CREATE POLICY debtor_ideb_uploads_read
  ON public.debtor_ideb_uploads
  FOR SELECT
  USING (
    (
      (
        uploaded_by = public.ruwang_arsip_current_user_id()
        OR created_by = public.ruwang_arsip_current_user_id()
      )
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY[
          '/dashboard/informasi-debitur',
          '/dashboard/informasi-debitur/master-debitur',
          '/dashboard/informasi-debitur/admin/upload-ideb',
          '/dashboard/informasi-debitur/admin/monitoring-import',
          '/dashboard/informasi-debitur/laporan-ideb',
          '/dashboard/informasi-debitur/laporan'
        ]::text[],
        'read'
      )
    )
    OR (debtor_id IS NOT NULL AND public.ruwang_arsip_can_read_debtor(debtor_id))
    OR (contract_id IS NOT NULL AND public.ruwang_arsip_can_read_contract(contract_id))
    OR (import_job_id IS NOT NULL AND public.ruwang_arsip_can_read_import_job(import_job_id))
  );

DROP POLICY IF EXISTS debtor_activity_logs_read
  ON public.debtor_activity_logs;
CREATE POLICY debtor_activity_logs_read
  ON public.debtor_activity_logs
  FOR SELECT
  USING (
    (debtor_id IS NOT NULL AND public.ruwang_arsip_can_read_debtor(debtor_id))
    OR (contract_id IS NOT NULL AND public.ruwang_arsip_can_read_contract(contract_id))
    OR (import_job_id IS NOT NULL AND public.ruwang_arsip_can_read_import_job(import_job_id))
    OR (
      actor_id = public.ruwang_arsip_current_user_id()
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY[
          '/dashboard/informasi-debitur',
          '/dashboard/informasi-debitur/master-debitur',
          '/dashboard/informasi-debitur/marketing/action-plan',
          '/dashboard/informasi-debitur/marketing/hasil-kunjungan',
          '/dashboard/informasi-debitur/marketing/langkah-penanganan',
          '/dashboard/informasi-debitur/admin/upload-slik',
          '/dashboard/informasi-debitur/admin/monitoring-import',
          '/dashboard/informasi-debitur/admin/upload-ideb',
          '/dashboard/informasi-debitur/laporan-ideb',
          '/dashboard/informasi-debitur/laporan'
        ]::text[],
        'read'
      )
    )
  );

DROP POLICY IF EXISTS legal_activity_logs_read
  ON public.legal_activity_logs;
CREATE POLICY legal_activity_logs_read
  ON public.legal_activity_logs
  FOR SELECT
  USING (
    (debtor_id IS NOT NULL AND public.ruwang_arsip_can_read_debtor(debtor_id))
    OR (contract_id IS NOT NULL AND public.ruwang_arsip_can_read_contract(contract_id))
    OR (
      actor_id = public.ruwang_arsip_current_user_id()
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY[
          '/dashboard/legal',
          '/dashboard/legal/titipan/asuransi',
          '/dashboard/legal/titipan/notaris',
          '/dashboard/legal/titipan/angsuran',
          '/dashboard/legal/titipan/lainnya',
          '/dashboard/legal/progress/notaris',
          '/dashboard/legal/progress/asuransi',
          '/dashboard/legal/progress/kjpp',
          '/dashboard/legal/progress/klaim',
          '/dashboard/legal/laporan',
          '/dashboard/legal/laporan/pihak-ketiga/dokumen',
          '/dashboard/legal/laporan/pihak-ketiga/dana-titipan'
        ]::text[],
        'read'
      )
    )
  );
