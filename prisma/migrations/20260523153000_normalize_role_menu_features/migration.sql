WITH allowed_menu_features(url, allowed_features) AS (
  VALUES
    ('/dashboard/arsip-digital/input-dokumen', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan', ARRAY['report_all', 'view_division']::TEXT[]),
    ('/dashboard/arsip-digital/ruang-arsip/list-dokumen', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/arsip-digital/ruang-arsip/jatuh-tempo', ARRAY['report_all', 'view_division']::TEXT[]),
    ('/dashboard/arsip-digital/disposisi/pengajuan', ARRAY['report_all', 'view_division']::TEXT[]),
    ('/dashboard/arsip-digital/disposisi/permintaan', ARRAY['report_all', 'view_division', 'approve', 'reject']::TEXT[]),
    ('/dashboard/arsip-digital/disposisi/historis', ARRAY['report_all', 'view_division']::TEXT[]),
    ('/dashboard/arsip-digital/peminjaman/request', ARRAY['report_all', 'view_division']::TEXT[]),
    ('/dashboard/arsip-digital/peminjaman/accept', ARRAY['report_all', 'view_division', 'approve', 'reject', 'handover', 'return']::TEXT[]),
    ('/dashboard/arsip-digital/peminjaman/laporan', ARRAY['report_all', 'view_division']::TEXT[]),
    ('/dashboard/arsip-digital/historis/penyimpanan', ARRAY['report_all', 'view_division']::TEXT[]),
    ('/dashboard/arsip-digital/historis/peminjaman', ARRAY['report_all', 'view_division']::TEXT[]),
    ('/dashboard/arsip-digital/laporan', ARRAY['report_all', 'view_division']::TEXT[]),
    ('/dashboard/manajemen-surat/laporan', ARRAY['report_all']::TEXT[]),
    ('/dashboard/manajemen-surat/cetak-dokumen', ARRAY['report_all', 'view_division']::TEXT[]),
    ('/dashboard/manajemen-surat/kelola-surat/input-surat-masuk', ARRAY['view_division', 'manage_all', 'division_manager', 'redispose']::TEXT[]),
    ('/dashboard/manajemen-surat/kelola-surat/input-surat-keluar', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/manajemen-surat/kelola-surat/input-memorandum', ARRAY['view_division', 'manage_all', 'division_manager', 'redispose']::TEXT[]),
    ('/dashboard/informasi-debitur/laporan', ARRAY['report_all']::TEXT[]),
    ('/dashboard/informasi-debitur', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/informasi-debitur/master-debitur', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/informasi-debitur/marketing/action-plan', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/informasi-debitur/marketing/hasil-kunjungan', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/informasi-debitur/marketing/langkah-penanganan', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/informasi-debitur/admin/upload-slik', ARRAY['manage_all']::TEXT[]),
    ('/dashboard/informasi-debitur/admin/upload-restrik', ARRAY['manage_all']::TEXT[]),
    ('/dashboard/informasi-debitur/admin/import-debitur', ARRAY['manage_all']::TEXT[]),
    ('/dashboard/informasi-debitur/admin/import-kolektibilitas', ARRAY['manage_all']::TEXT[]),
    ('/dashboard/informasi-debitur/laporan/npf', ARRAY['report_all']::TEXT[]),
    ('/dashboard/informasi-debitur/laporan/aktivitas-marketing', ARRAY['report_all']::TEXT[]),
    ('/dashboard/legal', ARRAY['report_all', 'view_division']::TEXT[]),
    ('/dashboard/legal/cetak/akad', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/legal/cetak/haftsheet', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/legal/cetak/surat-peringatan', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/legal/cetak/formulir-asuransi', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/legal/cetak/keterangan-lunas', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/legal/cetak/surat-samsat', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/legal/titipan/asuransi', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/legal/titipan/notaris', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/legal/titipan/angsuran', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/legal/progress/notaris', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/legal/progress/asuransi', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/legal/progress/kjpp', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/legal/progress/klaim', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/legal/upload-ideb', ARRAY['view_division', 'manage_all']::TEXT[]),
    ('/dashboard/legal/laporan', ARRAY['report_all', 'view_division']::TEXT[]),
    ('/dashboard/legal/laporan/pihak-ketiga/dokumen', ARRAY['report_all', 'view_division']::TEXT[]),
    ('/dashboard/legal/laporan/pihak-ketiga/dana-titipan', ARRAY['report_all', 'view_division']::TEXT[])
),
deduplicated_features AS (
  SELECT
    rm.id,
    COALESCE(
      ARRAY_AGG(feature_item.feature ORDER BY feature_item.first_position)
        FILTER (
          WHERE feature_item.feature = ANY(COALESCE(allowed_menu_features.allowed_features, ARRAY[]::TEXT[]))
            AND NOT (
              feature_item.feature = 'view_division'
              AND 'manage_all' = ANY(COALESCE(allowed_menu_features.allowed_features, ARRAY[]::TEXT[]))
              AND 'manage_all' = ANY(COALESCE(rm.features, ARRAY[]::TEXT[]))
            )
        ),
      ARRAY[]::TEXT[]
    ) AS features
  FROM "role_menus" rm
  JOIN "menus" m ON m.id = rm.menu_id
  LEFT JOIN allowed_menu_features ON allowed_menu_features.url = m.url
  LEFT JOIN LATERAL (
    SELECT feature, MIN(position) AS first_position
    FROM UNNEST(COALESCE(rm.features, ARRAY[]::TEXT[])) WITH ORDINALITY AS raw_features(feature, position)
    GROUP BY feature
  ) AS feature_item ON TRUE
  GROUP BY rm.id
)
UPDATE "role_menus" rm
SET features = deduplicated_features.features
FROM deduplicated_features
WHERE rm.id = deduplicated_features.id
  AND rm.features IS DISTINCT FROM deduplicated_features.features;
