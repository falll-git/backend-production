DELETE FROM "role_menus"
WHERE "menu_id" IN (
  SELECT "id"
  FROM "menus"
  WHERE "url" IN (
    '/dashboard/admin/upload-restrik',
    '/dashboard/informasi-debitur/admin/upload-restrik',
    '/dashboard/parameter/jenis-restrukturisasi'
  )
);

DELETE FROM "menus"
WHERE "url" IN (
  '/dashboard/admin/upload-restrik',
  '/dashboard/informasi-debitur/admin/upload-restrik',
  '/dashboard/parameter/jenis-restrukturisasi'
);

DROP TABLE IF EXISTS "debtor_restructuring_records";

DELETE FROM "debtor_external_records"
WHERE "source_type" = 'RESTRIK';

DELETE FROM "debtor_import_jobs"
WHERE "type" = 'RESTRIK';

DROP TABLE IF EXISTS "restructuring_types";
