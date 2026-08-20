DROP POLICY IF EXISTS debtor_ideb_uploads_write
  ON public.debtor_ideb_uploads;

CREATE POLICY debtor_ideb_uploads_write
  ON public.debtor_ideb_uploads
  FOR ALL
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
    OR (debtor_id IS NOT NULL AND public.ruwang_arsip_can_manage_debtor(debtor_id))
  )
  WITH CHECK (
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
    OR (debtor_id IS NOT NULL AND public.ruwang_arsip_can_manage_debtor(debtor_id))
  );
