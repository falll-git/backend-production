SET ROLE ruwang_arsip_policy;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_read_contract(target_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.debtor_contracts contract
    LEFT JOIN public.users marketing_user ON marketing_user.id = contract.marketing_user_id
    LEFT JOIN public.digital_debtors debtor ON debtor.id = contract.debtor_id
    LEFT JOIN public.users debtor_marketing ON debtor_marketing.id = debtor.marketing_user_id
    WHERE contract.id = target_id
      AND contract.deleted_at IS NULL
      AND public.ruwang_arsip_has_menu_permission(
        ARRAY[
          '/dashboard/informasi-debitur', '/dashboard/informasi-debitur/master-debitur',
          '/dashboard/informasi-debitur/marketing/action-plan', '/dashboard/informasi-debitur/marketing/hasil-kunjungan',
          '/dashboard/informasi-debitur/marketing/langkah-penanganan', '/dashboard/informasi-debitur/admin/upload-slik',
          '/dashboard/informasi-debitur/admin/monitoring-import', '/dashboard/informasi-debitur/admin/upload-ideb',
          '/dashboard/informasi-debitur/laporan-ideb', '/dashboard/informasi-debitur/laporan',
          '/dashboard/widgets/informasi-debitur/npf', '/dashboard/widgets/informasi-debitur/aktivitas-marketing',
          '/dashboard/legal/titipan/asuransi', '/dashboard/legal/titipan/notaris',
          '/dashboard/legal/titipan/angsuran', '/dashboard/legal/titipan/lainnya',
          '/dashboard/legal/progress/notaris', '/dashboard/legal/progress/asuransi',
          '/dashboard/legal/progress/kjpp', '/dashboard/legal/progress/klaim'
        ]::text[],
        'read'
      )
      AND (
        contract.created_by = public.ruwang_arsip_current_user_id()
        OR contract.marketing_user_id = public.ruwang_arsip_current_user_id()
        OR debtor.created_by = public.ruwang_arsip_current_user_id()
        OR debtor.marketing_user_id = public.ruwang_arsip_current_user_id()
        OR public.ruwang_arsip_has_menu_feature(
          ARRAY[
            '/dashboard/informasi-debitur', '/dashboard/informasi-debitur/master-debitur',
            '/dashboard/informasi-debitur/marketing/action-plan', '/dashboard/informasi-debitur/marketing/hasil-kunjungan',
            '/dashboard/informasi-debitur/marketing/langkah-penanganan', '/dashboard/informasi-debitur/admin/upload-slik',
            '/dashboard/informasi-debitur/admin/monitoring-import', '/dashboard/informasi-debitur/admin/upload-ideb',
            '/dashboard/informasi-debitur/laporan-ideb', '/dashboard/informasi-debitur/laporan',
            '/dashboard/widgets/informasi-debitur/npf', '/dashboard/widgets/informasi-debitur/aktivitas-marketing',
            '/dashboard/legal/titipan/asuransi', '/dashboard/legal/titipan/notaris',
            '/dashboard/legal/titipan/angsuran', '/dashboard/legal/titipan/lainnya',
            '/dashboard/legal/progress/notaris', '/dashboard/legal/progress/asuransi',
            '/dashboard/legal/progress/kjpp', '/dashboard/legal/progress/klaim'
          ]::text[],
          'manage_all'
        )
        OR public.ruwang_arsip_has_menu_feature(
          ARRAY[
            '/dashboard/informasi-debitur', '/dashboard/informasi-debitur/master-debitur',
            '/dashboard/informasi-debitur/marketing/action-plan', '/dashboard/informasi-debitur/marketing/hasil-kunjungan',
            '/dashboard/informasi-debitur/marketing/langkah-penanganan', '/dashboard/informasi-debitur/admin/upload-slik',
            '/dashboard/informasi-debitur/admin/monitoring-import', '/dashboard/informasi-debitur/admin/upload-ideb',
            '/dashboard/informasi-debitur/laporan-ideb', '/dashboard/informasi-debitur/laporan',
            '/dashboard/widgets/informasi-debitur/npf', '/dashboard/widgets/informasi-debitur/aktivitas-marketing',
            '/dashboard/legal/titipan/asuransi', '/dashboard/legal/titipan/notaris',
            '/dashboard/legal/titipan/angsuran', '/dashboard/legal/titipan/lainnya',
            '/dashboard/legal/progress/notaris', '/dashboard/legal/progress/asuransi',
            '/dashboard/legal/progress/kjpp', '/dashboard/legal/progress/klaim'
          ]::text[],
          'report_all'
        )
        OR (
          public.ruwang_arsip_has_menu_feature(
            ARRAY[
              '/dashboard/informasi-debitur', '/dashboard/informasi-debitur/master-debitur',
              '/dashboard/informasi-debitur/marketing/action-plan', '/dashboard/informasi-debitur/marketing/hasil-kunjungan',
              '/dashboard/informasi-debitur/marketing/langkah-penanganan', '/dashboard/informasi-debitur/admin/upload-slik',
              '/dashboard/informasi-debitur/admin/monitoring-import', '/dashboard/informasi-debitur/admin/upload-ideb',
              '/dashboard/informasi-debitur/laporan-ideb', '/dashboard/informasi-debitur/laporan',
              '/dashboard/widgets/informasi-debitur/npf', '/dashboard/widgets/informasi-debitur/aktivitas-marketing',
              '/dashboard/legal/titipan/asuransi', '/dashboard/legal/titipan/notaris',
              '/dashboard/legal/titipan/angsuran', '/dashboard/legal/titipan/lainnya',
              '/dashboard/legal/progress/notaris', '/dashboard/legal/progress/asuransi',
              '/dashboard/legal/progress/kjpp', '/dashboard/legal/progress/klaim'
            ]::text[],
            'view_division'
          )
          AND (
            marketing_user.division_id = public.ruwang_arsip_current_user_division_id()
            OR debtor_marketing.division_id = public.ruwang_arsip_current_user_division_id()
          )
        )
      )
  )
$$;

RESET ROLE;
