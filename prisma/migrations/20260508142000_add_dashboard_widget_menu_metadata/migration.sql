ALTER TABLE "menus"
  ADD COLUMN "menu_type" TEXT NOT NULL DEFAULT 'NAVIGATION',
  ADD COLUMN "placement" TEXT NOT NULL DEFAULT 'SIDEBAR',
  ADD COLUMN "render_in_sidebar" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "component_key" TEXT;

CREATE INDEX IF NOT EXISTS "menus_menu_type_idx" ON "menus"("menu_type");
CREATE INDEX IF NOT EXISTS "menus_placement_idx" ON "menus"("placement");
CREATE INDEX IF NOT EXISTS "menus_render_in_sidebar_idx" ON "menus"("render_in_sidebar");

UPDATE "menus"
SET
  "menu_type" = 'DASHBOARD_WIDGET',
  "placement" = 'DASHBOARD',
  "render_in_sidebar" = false,
  "component_key" = CASE "url"
    WHEN '/dashboard/legal/laporan/pihak-ketiga/dokumen' THEN 'dashboard.report.third_party_documents'
    WHEN '/dashboard/legal/laporan/pihak-ketiga/dana-titipan' THEN 'dashboard.report.third_party_deposit_funds'
    WHEN '/dashboard/informasi-debitur/laporan/npf' THEN 'dashboard.report.npf'
    WHEN '/dashboard/informasi-debitur/laporan/aktivitas-marketing' THEN 'dashboard.report.marketing_activity'
    ELSE "component_key"
  END
WHERE "url" IN (
  '/dashboard/legal/laporan/pihak-ketiga/dokumen',
  '/dashboard/legal/laporan/pihak-ketiga/dana-titipan',
  '/dashboard/informasi-debitur/laporan/npf',
  '/dashboard/informasi-debitur/laporan/aktivitas-marketing'
);
