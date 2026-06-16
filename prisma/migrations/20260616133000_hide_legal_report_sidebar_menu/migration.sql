UPDATE "menus"
SET "render_in_sidebar" = FALSE,
    "updated_at" = NOW()
WHERE "url" = '/dashboard/legal/laporan';
