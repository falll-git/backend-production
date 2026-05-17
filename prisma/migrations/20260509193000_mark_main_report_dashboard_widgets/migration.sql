UPDATE "menus"
SET
  "menu_type" = 'DASHBOARD_WIDGET',
  "placement" = 'DASHBOARD',
  "render_in_sidebar" = true,
  "component_key" = CASE "url"
    WHEN '/dashboard/arsip-digital/laporan' THEN 'dashboard.module_report.digital_archive'
    WHEN '/dashboard/manajemen-surat/laporan' THEN 'dashboard.module_report.correspondence'
    WHEN '/dashboard/informasi-debitur/laporan' THEN 'dashboard.module_report.debtor'
    WHEN '/dashboard/legal/laporan' THEN 'dashboard.module_report.legal'
    ELSE "component_key"
  END
WHERE "url" IN (
  '/dashboard/arsip-digital/laporan',
  '/dashboard/manajemen-surat/laporan',
  '/dashboard/informasi-debitur/laporan',
  '/dashboard/legal/laporan'
);
