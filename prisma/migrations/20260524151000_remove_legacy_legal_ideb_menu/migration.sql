DELETE FROM "role_menus"
WHERE "menu_id" IN (
  SELECT "id" FROM "menus" WHERE "url" = '/dashboard/legal/upload-ideb'
);

DELETE FROM "menus"
WHERE "url" = '/dashboard/legal/upload-ideb';
