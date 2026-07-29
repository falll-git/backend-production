GRANT SELECT ON ALL TABLES IN SCHEMA public TO ruwang_arsip_policy;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_read_debtor(target_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.digital_debtors debtor
    LEFT JOIN public.users marketing_user ON marketing_user.id = debtor.marketing_user_id
    WHERE debtor.id = target_id
      AND debtor.deleted_at IS NULL
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
          '/dashboard/informasi-debitur/laporan',
          '/dashboard/widgets/informasi-debitur/npf',
          '/dashboard/widgets/informasi-debitur/aktivitas-marketing',
          '/dashboard/legal/titipan/asuransi',
          '/dashboard/legal/titipan/notaris',
          '/dashboard/legal/titipan/angsuran',
          '/dashboard/legal/titipan/lainnya',
          '/dashboard/legal/progress/notaris',
          '/dashboard/legal/progress/asuransi',
          '/dashboard/legal/progress/kjpp',
          '/dashboard/legal/progress/klaim'
        ]::text[],
        'read'
      )
      AND (
        debtor.created_by = public.ruwang_arsip_current_user_id()
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
        OR EXISTS (
          SELECT 1 FROM public.debtor_contracts contract
          WHERE contract.debtor_id = debtor.id
            AND (
              contract.created_by = public.ruwang_arsip_current_user_id()
              OR contract.marketing_user_id = public.ruwang_arsip_current_user_id()
            )
        )
        OR EXISTS (
          SELECT 1 FROM public.debtor_marketing_activities activity
          WHERE activity.debtor_id = debtor.id
            AND activity.created_by = public.ruwang_arsip_current_user_id()
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
            OR EXISTS (
              SELECT 1
              FROM public.debtor_contracts contract
              JOIN public.users contract_marketing ON contract_marketing.id = contract.marketing_user_id
              WHERE contract.debtor_id = debtor.id
                AND contract_marketing.division_id = public.ruwang_arsip_current_user_division_id()
            )
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_manage_debtor(target_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.digital_debtors debtor
    WHERE debtor.id = target_id
      AND (
        debtor.created_by = public.ruwang_arsip_current_user_id()
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
      )
  )
$$;

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

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_manage_contract(target_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.debtor_contracts contract
    JOIN public.digital_debtors debtor ON debtor.id = contract.debtor_id
    WHERE contract.id = target_id
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
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.ruwang_arsip_can_read_import_job(target_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.debtor_import_jobs job WHERE job.id = target_id AND job.deleted_at IS NULL)
    AND public.ruwang_arsip_has_menu_permission(
      ARRAY[
        '/dashboard/informasi-debitur/admin/upload-slik',
        '/dashboard/informasi-debitur/admin/monitoring-import',
        '/dashboard/informasi-debitur/admin/upload-ideb'
      ]::text[],
      'read'
    )
$$;

ALTER FUNCTION public.ruwang_arsip_can_read_debtor(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_manage_debtor(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_read_contract(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_manage_contract(text) OWNER TO ruwang_arsip_policy;
ALTER FUNCTION public.ruwang_arsip_can_read_import_job(text) OWNER TO ruwang_arsip_policy;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_read_debtor(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_manage_debtor(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_read_contract(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_manage_contract(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ruwang_arsip_can_read_import_job(text) FROM PUBLIC;

DO $grant_app$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_app') THEN
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_read_debtor(text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_manage_debtor(text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_read_contract(text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_manage_contract(text) TO ruwang_arsip_app;
    GRANT EXECUTE ON FUNCTION public.ruwang_arsip_can_read_import_job(text) TO ruwang_arsip_app;
  END IF;
END
$grant_app$;

ALTER TABLE public.digital_debtors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_debtors FORCE ROW LEVEL SECURITY;
CREATE POLICY digital_debtors_read ON public.digital_debtors FOR SELECT
  USING (public.ruwang_arsip_can_read_debtor(id));
CREATE POLICY digital_debtors_create ON public.digital_debtors FOR INSERT
  WITH CHECK (
    created_by = public.ruwang_arsip_current_user_id()
    AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/informasi-debitur/master-debitur']::text[], 'create')
  );
CREATE POLICY digital_debtors_update ON public.digital_debtors FOR UPDATE
  USING (
    public.ruwang_arsip_can_manage_debtor(id)
    AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/informasi-debitur/master-debitur']::text[], 'update')
  )
  WITH CHECK (public.ruwang_arsip_can_manage_debtor(id));
CREATE POLICY digital_debtors_delete ON public.digital_debtors FOR DELETE
  USING (
    public.ruwang_arsip_can_manage_debtor(id)
    AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/informasi-debitur/master-debitur']::text[], 'delete')
  );

ALTER TABLE public.debtor_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_contracts_read ON public.debtor_contracts FOR SELECT
  USING (public.ruwang_arsip_can_read_contract(id));
CREATE POLICY debtor_contracts_create ON public.debtor_contracts FOR INSERT
  WITH CHECK (
    created_by = public.ruwang_arsip_current_user_id()
    AND public.ruwang_arsip_can_manage_debtor(debtor_id)
    AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/informasi-debitur/master-debitur']::text[], 'create')
  );
CREATE POLICY debtor_contracts_update ON public.debtor_contracts FOR UPDATE
  USING (
    public.ruwang_arsip_can_manage_contract(id)
    AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/informasi-debitur/master-debitur']::text[], 'update')
  )
  WITH CHECK (public.ruwang_arsip_can_manage_debtor(debtor_id));
CREATE POLICY debtor_contracts_delete ON public.debtor_contracts FOR DELETE
  USING (
    public.ruwang_arsip_can_manage_contract(id)
    AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/informasi-debitur/master-debitur']::text[], 'delete')
  );

-- One-to-one debtor profiles inherit the exact parent scope.
ALTER TABLE public.debtor_individual_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_individual_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_individual_profiles_read ON public.debtor_individual_profiles FOR SELECT USING (public.ruwang_arsip_can_read_debtor(debtor_id));
CREATE POLICY debtor_individual_profiles_write ON public.debtor_individual_profiles FOR ALL USING (public.ruwang_arsip_can_manage_debtor(debtor_id)) WITH CHECK (public.ruwang_arsip_can_manage_debtor(debtor_id));
ALTER TABLE public.debtor_legal_entity_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_legal_entity_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_legal_entity_profiles_read ON public.debtor_legal_entity_profiles FOR SELECT USING (public.ruwang_arsip_can_read_debtor(debtor_id));
CREATE POLICY debtor_legal_entity_profiles_write ON public.debtor_legal_entity_profiles FOR ALL USING (public.ruwang_arsip_can_manage_debtor(debtor_id)) WITH CHECK (public.ruwang_arsip_can_manage_debtor(debtor_id));

ALTER TABLE public.debtor_collectibilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_collectibilities FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_collectibilities_read ON public.debtor_collectibilities FOR SELECT USING (public.ruwang_arsip_can_read_contract(contract_id));
CREATE POLICY debtor_collectibilities_write ON public.debtor_collectibilities FOR ALL USING (public.ruwang_arsip_can_manage_contract(contract_id)) WITH CHECK (public.ruwang_arsip_can_manage_contract(contract_id));
ALTER TABLE public.debtor_contract_slik_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_contract_slik_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_contract_slik_snapshots_read ON public.debtor_contract_slik_snapshots FOR SELECT USING (public.ruwang_arsip_can_read_contract(contract_id));
CREATE POLICY debtor_contract_slik_snapshots_write ON public.debtor_contract_slik_snapshots FOR ALL USING (public.ruwang_arsip_can_manage_contract(contract_id)) WITH CHECK (public.ruwang_arsip_can_manage_contract(contract_id));

ALTER TABLE public.debtor_collaterals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_collaterals FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_collaterals_read ON public.debtor_collaterals FOR SELECT USING (
  (debtor_id IS NOT NULL AND public.ruwang_arsip_can_read_debtor(debtor_id))
  OR (contract_id IS NOT NULL AND public.ruwang_arsip_can_read_contract(contract_id))
);
CREATE POLICY debtor_collaterals_write ON public.debtor_collaterals FOR ALL USING (
  (debtor_id IS NOT NULL AND public.ruwang_arsip_can_manage_debtor(debtor_id))
  OR (contract_id IS NOT NULL AND public.ruwang_arsip_can_manage_contract(contract_id))
) WITH CHECK (
  (debtor_id IS NOT NULL AND public.ruwang_arsip_can_manage_debtor(debtor_id))
  OR (contract_id IS NOT NULL AND public.ruwang_arsip_can_manage_contract(contract_id))
);

ALTER TABLE public.debtor_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_import_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_import_jobs_read ON public.debtor_import_jobs FOR SELECT USING (public.ruwang_arsip_can_read_import_job(id));
CREATE POLICY debtor_import_jobs_create ON public.debtor_import_jobs FOR INSERT WITH CHECK (
  created_by = public.ruwang_arsip_current_user_id()
  AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/informasi-debitur/admin/upload-slik','/dashboard/informasi-debitur/admin/upload-ideb']::text[], 'create')
);
CREATE POLICY debtor_import_jobs_update ON public.debtor_import_jobs FOR UPDATE USING (
  public.ruwang_arsip_can_read_import_job(id)
  AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/informasi-debitur/admin/upload-slik','/dashboard/informasi-debitur/admin/upload-ideb']::text[], 'create')
) WITH CHECK (public.ruwang_arsip_can_read_import_job(id));

ALTER TABLE public.debtor_import_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_import_segments FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_import_segments_read ON public.debtor_import_segments FOR SELECT USING (public.ruwang_arsip_can_read_import_job(import_job_id));
CREATE POLICY debtor_import_segments_write ON public.debtor_import_segments FOR ALL USING (public.ruwang_arsip_can_read_import_job(import_job_id)) WITH CHECK (public.ruwang_arsip_can_read_import_job(import_job_id));
ALTER TABLE public.debtor_slik_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_slik_records FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_slik_records_read ON public.debtor_slik_records FOR SELECT USING (
  public.ruwang_arsip_can_read_import_job(import_job_id)
  OR (debtor_id IS NOT NULL AND public.ruwang_arsip_can_read_debtor(debtor_id))
  OR (contract_id IS NOT NULL AND public.ruwang_arsip_can_read_contract(contract_id))
);
CREATE POLICY debtor_slik_records_write ON public.debtor_slik_records FOR ALL USING (public.ruwang_arsip_can_read_import_job(import_job_id)) WITH CHECK (public.ruwang_arsip_can_read_import_job(import_job_id));
ALTER TABLE public.debtor_external_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_external_records FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_external_records_read ON public.debtor_external_records FOR SELECT USING (
  (import_job_id IS NOT NULL AND public.ruwang_arsip_can_read_import_job(import_job_id))
  OR (debtor_id IS NOT NULL AND public.ruwang_arsip_can_read_debtor(debtor_id))
  OR (contract_id IS NOT NULL AND public.ruwang_arsip_can_read_contract(contract_id))
);
CREATE POLICY debtor_external_records_write ON public.debtor_external_records FOR ALL USING (
  (import_job_id IS NOT NULL AND public.ruwang_arsip_can_read_import_job(import_job_id))
  OR created_by = public.ruwang_arsip_current_user_id()
) WITH CHECK (
  (import_job_id IS NOT NULL AND public.ruwang_arsip_can_read_import_job(import_job_id))
  OR created_by = public.ruwang_arsip_current_user_id()
);

ALTER TABLE public.debtor_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_documents_read ON public.debtor_documents FOR SELECT USING (public.ruwang_arsip_can_read_debtor(debtor_id));
CREATE POLICY debtor_documents_write ON public.debtor_documents FOR ALL USING (public.ruwang_arsip_can_manage_debtor(debtor_id)) WITH CHECK (public.ruwang_arsip_can_manage_debtor(debtor_id));
ALTER TABLE public.debtor_document_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_document_files FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_document_files_read ON public.debtor_document_files FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.debtor_documents document WHERE document.id = document_id)
);
CREATE POLICY debtor_document_files_write ON public.debtor_document_files FOR ALL USING (
  EXISTS (SELECT 1 FROM public.debtor_documents document WHERE document.id = document_id AND public.ruwang_arsip_can_manage_debtor(document.debtor_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.debtor_documents document WHERE document.id = document_id AND public.ruwang_arsip_can_manage_debtor(document.debtor_id))
);

ALTER TABLE public.debtor_marketing_timelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_marketing_timelines FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_marketing_timelines_read ON public.debtor_marketing_timelines FOR SELECT USING (public.ruwang_arsip_can_read_debtor(debtor_id));
CREATE POLICY debtor_marketing_timelines_write ON public.debtor_marketing_timelines FOR ALL USING (public.ruwang_arsip_can_manage_debtor(debtor_id)) WITH CHECK (public.ruwang_arsip_can_manage_debtor(debtor_id));
ALTER TABLE public.debtor_marketing_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_marketing_activities FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_marketing_activities_read ON public.debtor_marketing_activities FOR SELECT USING (public.ruwang_arsip_can_read_debtor(debtor_id));
CREATE POLICY debtor_marketing_activities_write ON public.debtor_marketing_activities FOR ALL USING (public.ruwang_arsip_can_manage_debtor(debtor_id)) WITH CHECK (public.ruwang_arsip_can_manage_debtor(debtor_id));
ALTER TABLE public.debtor_marketing_activity_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_marketing_activity_files FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_marketing_activity_files_read ON public.debtor_marketing_activity_files FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.debtor_marketing_activities activity WHERE activity.id = activity_id)
);
CREATE POLICY debtor_marketing_activity_files_write ON public.debtor_marketing_activity_files FOR ALL USING (
  EXISTS (SELECT 1 FROM public.debtor_marketing_activities activity WHERE activity.id = activity_id AND public.ruwang_arsip_can_manage_debtor(activity.debtor_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.debtor_marketing_activities activity WHERE activity.id = activity_id AND public.ruwang_arsip_can_manage_debtor(activity.debtor_id))
);

ALTER TABLE public.debtor_warning_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_warning_letters FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_warning_letters_read ON public.debtor_warning_letters FOR SELECT USING (public.ruwang_arsip_can_read_debtor(debtor_id));
CREATE POLICY debtor_warning_letters_write ON public.debtor_warning_letters FOR ALL USING (public.ruwang_arsip_can_manage_debtor(debtor_id)) WITH CHECK (public.ruwang_arsip_can_manage_debtor(debtor_id));
ALTER TABLE public.debtor_warning_letter_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_warning_letter_files FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_warning_letter_files_read ON public.debtor_warning_letter_files FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.debtor_warning_letters letter WHERE letter.id = letter_id)
);
CREATE POLICY debtor_warning_letter_files_write ON public.debtor_warning_letter_files FOR ALL USING (
  EXISTS (SELECT 1 FROM public.debtor_warning_letters letter WHERE letter.id = letter_id AND public.ruwang_arsip_can_manage_debtor(letter.debtor_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.debtor_warning_letters letter WHERE letter.id = letter_id AND public.ruwang_arsip_can_manage_debtor(letter.debtor_id))
);

ALTER TABLE public.debtor_ideb_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_ideb_uploads FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_ideb_uploads_read ON public.debtor_ideb_uploads FOR SELECT USING (
  uploaded_by = public.ruwang_arsip_current_user_id()
  OR created_by = public.ruwang_arsip_current_user_id()
  OR (debtor_id IS NOT NULL AND public.ruwang_arsip_can_read_debtor(debtor_id))
  OR (contract_id IS NOT NULL AND public.ruwang_arsip_can_read_contract(contract_id))
  OR (import_job_id IS NOT NULL AND public.ruwang_arsip_can_read_import_job(import_job_id))
);
CREATE POLICY debtor_ideb_uploads_write ON public.debtor_ideb_uploads FOR ALL USING (
  uploaded_by = public.ruwang_arsip_current_user_id()
  OR created_by = public.ruwang_arsip_current_user_id()
  OR (debtor_id IS NOT NULL AND public.ruwang_arsip_can_manage_debtor(debtor_id))
) WITH CHECK (
  uploaded_by = public.ruwang_arsip_current_user_id()
  OR created_by = public.ruwang_arsip_current_user_id()
  OR (debtor_id IS NOT NULL AND public.ruwang_arsip_can_manage_debtor(debtor_id))
);
ALTER TABLE public.debtor_ideb_upload_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_ideb_upload_files FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_ideb_upload_files_read ON public.debtor_ideb_upload_files FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.debtor_ideb_uploads upload WHERE upload.id = upload_id)
);
CREATE POLICY debtor_ideb_upload_files_write ON public.debtor_ideb_upload_files FOR ALL USING (
  EXISTS (SELECT 1 FROM public.debtor_ideb_uploads upload WHERE upload.id = upload_id AND (upload.uploaded_by = public.ruwang_arsip_current_user_id() OR upload.created_by = public.ruwang_arsip_current_user_id()))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.debtor_ideb_uploads upload WHERE upload.id = upload_id AND (upload.uploaded_by = public.ruwang_arsip_current_user_id() OR upload.created_by = public.ruwang_arsip_current_user_id()))
);

ALTER TABLE public.debtor_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtor_activity_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY debtor_activity_logs_read ON public.debtor_activity_logs FOR SELECT USING (
  (debtor_id IS NOT NULL AND public.ruwang_arsip_can_read_debtor(debtor_id))
  OR (contract_id IS NOT NULL AND public.ruwang_arsip_can_read_contract(contract_id))
  OR (import_job_id IS NOT NULL AND public.ruwang_arsip_can_read_import_job(import_job_id))
  OR actor_id = public.ruwang_arsip_current_user_id()
);
CREATE POLICY debtor_activity_logs_create ON public.debtor_activity_logs FOR INSERT WITH CHECK (
  actor_id IS NULL OR actor_id = public.ruwang_arsip_current_user_id()
);

-- Legal operational records inherit contract scope and retain their route-level capability.
ALTER TABLE public.legal_notary_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_notary_progress FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_notary_progress_read ON public.legal_notary_progress FOR SELECT USING (public.ruwang_arsip_can_read_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/notaris']::text[], 'read'));
CREATE POLICY legal_notary_progress_create ON public.legal_notary_progress FOR INSERT WITH CHECK (created_by = public.ruwang_arsip_current_user_id() AND public.ruwang_arsip_can_manage_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/notaris']::text[], 'create'));
CREATE POLICY legal_notary_progress_update ON public.legal_notary_progress FOR UPDATE USING (public.ruwang_arsip_can_manage_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/notaris']::text[], 'update')) WITH CHECK (public.ruwang_arsip_can_manage_contract(contract_id));
CREATE POLICY legal_notary_progress_delete ON public.legal_notary_progress FOR DELETE USING (public.ruwang_arsip_can_manage_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/notaris']::text[], 'delete'));

ALTER TABLE public.legal_insurance_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_insurance_progress FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_insurance_progress_read ON public.legal_insurance_progress FOR SELECT USING (public.ruwang_arsip_can_read_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/asuransi']::text[], 'read'));
CREATE POLICY legal_insurance_progress_create ON public.legal_insurance_progress FOR INSERT WITH CHECK (created_by = public.ruwang_arsip_current_user_id() AND public.ruwang_arsip_can_manage_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/asuransi']::text[], 'create'));
CREATE POLICY legal_insurance_progress_update ON public.legal_insurance_progress FOR UPDATE USING (public.ruwang_arsip_can_manage_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/asuransi']::text[], 'update')) WITH CHECK (public.ruwang_arsip_can_manage_contract(contract_id));
CREATE POLICY legal_insurance_progress_delete ON public.legal_insurance_progress FOR DELETE USING (public.ruwang_arsip_can_manage_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/asuransi']::text[], 'delete'));

ALTER TABLE public.legal_kjpp_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_kjpp_progress FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_kjpp_progress_read ON public.legal_kjpp_progress FOR SELECT USING (public.ruwang_arsip_can_read_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/kjpp']::text[], 'read'));
CREATE POLICY legal_kjpp_progress_create ON public.legal_kjpp_progress FOR INSERT WITH CHECK (created_by = public.ruwang_arsip_current_user_id() AND public.ruwang_arsip_can_manage_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/kjpp']::text[], 'create'));
CREATE POLICY legal_kjpp_progress_update ON public.legal_kjpp_progress FOR UPDATE USING (public.ruwang_arsip_can_manage_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/kjpp']::text[], 'update')) WITH CHECK (public.ruwang_arsip_can_manage_contract(contract_id));
CREATE POLICY legal_kjpp_progress_delete ON public.legal_kjpp_progress FOR DELETE USING (public.ruwang_arsip_can_manage_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/kjpp']::text[], 'delete'));

ALTER TABLE public.legal_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_claims_read ON public.legal_claims FOR SELECT USING (public.ruwang_arsip_can_read_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/klaim']::text[], 'read'));
CREATE POLICY legal_claims_create ON public.legal_claims FOR INSERT WITH CHECK (created_by = public.ruwang_arsip_current_user_id() AND public.ruwang_arsip_can_manage_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/klaim']::text[], 'create'));
CREATE POLICY legal_claims_update ON public.legal_claims FOR UPDATE USING (public.ruwang_arsip_can_manage_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/klaim']::text[], 'update')) WITH CHECK (public.ruwang_arsip_can_manage_contract(contract_id));
CREATE POLICY legal_claims_delete ON public.legal_claims FOR DELETE USING (public.ruwang_arsip_can_manage_contract(contract_id) AND public.ruwang_arsip_has_menu_permission(ARRAY['/dashboard/legal/progress/klaim']::text[], 'delete'));

ALTER TABLE public.legal_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_deposits FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_deposits_read ON public.legal_deposits FOR SELECT USING (
  public.ruwang_arsip_can_read_contract(contract_id)
  AND public.ruwang_arsip_has_menu_permission(ARRAY[
    '/dashboard/legal/titipan/notaris','/dashboard/legal/titipan/asuransi','/dashboard/legal/titipan/angsuran','/dashboard/legal/titipan/lainnya'
  ]::text[], 'read')
);
CREATE POLICY legal_deposits_create ON public.legal_deposits FOR INSERT WITH CHECK (
  created_by = public.ruwang_arsip_current_user_id() AND public.ruwang_arsip_can_manage_contract(contract_id)
  AND public.ruwang_arsip_has_menu_permission(ARRAY[
    CASE type WHEN 'NOTARIS' THEN '/dashboard/legal/titipan/notaris' WHEN 'ASURANSI' THEN '/dashboard/legal/titipan/asuransi' WHEN 'ANGSURAN' THEN '/dashboard/legal/titipan/angsuran' ELSE '/dashboard/legal/titipan/lainnya' END
  ]::text[], 'create')
);
CREATE POLICY legal_deposits_update ON public.legal_deposits FOR UPDATE USING (
  public.ruwang_arsip_can_manage_contract(contract_id)
  AND public.ruwang_arsip_has_menu_permission(ARRAY[
    CASE type WHEN 'NOTARIS' THEN '/dashboard/legal/titipan/notaris' WHEN 'ASURANSI' THEN '/dashboard/legal/titipan/asuransi' WHEN 'ANGSURAN' THEN '/dashboard/legal/titipan/angsuran' ELSE '/dashboard/legal/titipan/lainnya' END
  ]::text[], 'update')
) WITH CHECK (public.ruwang_arsip_can_manage_contract(contract_id));
CREATE POLICY legal_deposits_delete ON public.legal_deposits FOR DELETE USING (
  public.ruwang_arsip_can_manage_contract(contract_id)
  AND public.ruwang_arsip_has_menu_permission(ARRAY[
    CASE type WHEN 'NOTARIS' THEN '/dashboard/legal/titipan/notaris' WHEN 'ASURANSI' THEN '/dashboard/legal/titipan/asuransi' WHEN 'ANGSURAN' THEN '/dashboard/legal/titipan/angsuran' ELSE '/dashboard/legal/titipan/lainnya' END
  ]::text[], 'delete')
);

ALTER TABLE public.legal_deposit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_deposit_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_deposit_transactions_read ON public.legal_deposit_transactions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.legal_deposits deposit WHERE deposit.id = deposit_id)
);
CREATE POLICY legal_deposit_transactions_write ON public.legal_deposit_transactions FOR ALL USING (
  EXISTS (SELECT 1 FROM public.legal_deposits deposit WHERE deposit.id = deposit_id AND public.ruwang_arsip_can_manage_contract(deposit.contract_id))
) WITH CHECK (
  created_by = public.ruwang_arsip_current_user_id()
  AND EXISTS (SELECT 1 FROM public.legal_deposits deposit WHERE deposit.id = deposit_id AND public.ruwang_arsip_can_manage_contract(deposit.contract_id))
);

-- File rows are visible only when the corresponding protected parent is visible.
ALTER TABLE public.legal_notary_progress_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_notary_progress_files FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_notary_progress_files_parent ON public.legal_notary_progress_files FOR ALL USING (EXISTS (SELECT 1 FROM public.legal_notary_progress parent WHERE parent.id = progress_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.legal_notary_progress parent WHERE parent.id = progress_id));
ALTER TABLE public.legal_insurance_progress_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_insurance_progress_files FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_insurance_progress_files_parent ON public.legal_insurance_progress_files FOR ALL USING (EXISTS (SELECT 1 FROM public.legal_insurance_progress parent WHERE parent.id = progress_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.legal_insurance_progress parent WHERE parent.id = progress_id));
ALTER TABLE public.legal_kjpp_progress_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_kjpp_progress_files FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_kjpp_progress_files_parent ON public.legal_kjpp_progress_files FOR ALL USING (EXISTS (SELECT 1 FROM public.legal_kjpp_progress parent WHERE parent.id = progress_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.legal_kjpp_progress parent WHERE parent.id = progress_id));
ALTER TABLE public.legal_claim_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_claim_files FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_claim_files_parent ON public.legal_claim_files FOR ALL USING (EXISTS (SELECT 1 FROM public.legal_claims parent WHERE parent.id = claim_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.legal_claims parent WHERE parent.id = claim_id));
ALTER TABLE public.legal_deposit_transaction_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_deposit_transaction_files FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_deposit_transaction_files_parent ON public.legal_deposit_transaction_files FOR ALL USING (EXISTS (SELECT 1 FROM public.legal_deposit_transactions parent WHERE parent.id = transaction_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.legal_deposit_transactions parent WHERE parent.id = transaction_id));

ALTER TABLE public.legal_print_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_print_histories FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_print_histories_read ON public.legal_print_histories FOR SELECT USING (public.ruwang_arsip_can_read_contract(contract_id));
CREATE POLICY legal_print_histories_write ON public.legal_print_histories FOR ALL USING (public.ruwang_arsip_can_manage_contract(contract_id)) WITH CHECK (public.ruwang_arsip_can_manage_contract(contract_id));
ALTER TABLE public.legal_print_history_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_print_history_files FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_print_history_files_parent ON public.legal_print_history_files FOR ALL USING (EXISTS (SELECT 1 FROM public.legal_print_histories parent WHERE parent.id = print_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.legal_print_histories parent WHERE parent.id = print_id));

ALTER TABLE public.legal_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_activity_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_activity_logs_read ON public.legal_activity_logs FOR SELECT USING (
  (debtor_id IS NOT NULL AND public.ruwang_arsip_can_read_debtor(debtor_id))
  OR (contract_id IS NOT NULL AND public.ruwang_arsip_can_read_contract(contract_id))
  OR actor_id = public.ruwang_arsip_current_user_id()
);
CREATE POLICY legal_activity_logs_create ON public.legal_activity_logs FOR INSERT WITH CHECK (
  actor_id IS NULL OR actor_id = public.ruwang_arsip_current_user_id()
);
