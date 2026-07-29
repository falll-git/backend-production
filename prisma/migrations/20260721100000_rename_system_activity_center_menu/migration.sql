UPDATE "menus"
SET
  "name" = 'Pusat Log Aktivitas',
  "updated_at" = NOW()
WHERE "url" = '/dashboard/activity-centre';
