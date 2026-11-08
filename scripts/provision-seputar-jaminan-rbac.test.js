const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ADMIN_POLICY_BY_URL,
  REQUIRED_MENUS,
  assertApplyStateSafe,
  menuNeedsUpdate,
  permissionData,
  permissionMeetsPolicy,
  resolveProvisionDatabase,
  summarizeProvisionState,
} = require("./provision-seputar-jaminan-rbac");

const safeEnv = {
  MIGRATION_DATABASE_URL:
    "postgresql://migration:secret@127.0.0.1:5432/ruwang_arsip_local?schema=public",
};

function menuRow(menu, index, rootId = "menu-root") {
  return {
    id: index === 0 ? rootId : `menu-${index}`,
    name: menu.name,
    url: menu.url,
    icon: menu.icon,
    sort_order: menu.order,
    parent_id: menu.parentUrl ? rootId : null,
    parent_label: menu.parentLabel,
    menu_type: "NAVIGATION",
    placement: "SIDEBAR",
    render_in_sidebar: true,
    component_key: null,
  };
}

function roleMenuRow(menu, index) {
  return {
    id: `permission-${index}`,
    role_id: "admin-role",
    menu_id: menu.id,
    ...permissionData(ADMIN_POLICY_BY_URL.get(menu.url)),
  };
}

test("dry-run menerima database PostgreSQL loopback tanpa persetujuan apply", () => {
  const result = resolveProvisionDatabase(safeEnv);
  assert.equal(result.databaseName, "ruwang_arsip_local");
  assert.equal(result.hostname, "127.0.0.1");
});

test("provisioning menolak database remote", () => {
  assert.throws(
    () =>
      resolveProvisionDatabase({
        MIGRATION_DATABASE_URL:
          "postgresql://migration:secret@database.internal:5432/ruwang_arsip",
      }),
    /loopback host/,
  );
});

test("apply memerlukan persetujuan dan nama database yang cocok", () => {
  assert.throws(
    () => resolveProvisionDatabase(safeEnv, { apply: true }),
    /SJ_RBAC_PROVISION_ALLOW=true/,
  );
  assert.throws(
    () =>
      resolveProvisionDatabase(
        {
          ...safeEnv,
          SJ_RBAC_PROVISION_ALLOW: "true",
          SJ_RBAC_PROVISION_TARGET_DATABASE: "database_lain",
        },
        { apply: true },
      ),
    /sama persis/,
  );
  assert.equal(
    resolveProvisionDatabase(
      {
        ...safeEnv,
        SJ_RBAC_PROVISION_ALLOW: "true",
        SJ_RBAC_PROVISION_TARGET_DATABASE: "ruwang_arsip_local",
      },
      { apply: true },
    ).databaseName,
    "ruwang_arsip_local",
  );
});

test("definisi provisioning memuat satu parent, tepat lima child, dan kebijakan Admin per child", () => {
  assert.equal(REQUIRED_MENUS.length, 6);
  assert.equal(ADMIN_POLICY_BY_URL.size, 5);
  assert.equal(REQUIRED_MENUS[0].parentUrl, null);
  assert.equal(
    REQUIRED_MENUS.slice(1).every(
      (menu) => menu.parentUrl === REQUIRED_MENUS[0].url,
    ),
    true,
  );
});

test("state kosong merencanakan enam menu dan lima permission Admin", () => {
  const summary = summarizeProvisionState({
    menusByUrl: new Map(),
    roleMenusByMenuId: new Map(),
  });
  assert.equal(summary.missingMenus.length, 6);
  assert.equal(summary.missingAdminPermissions.length, 5);
  assert.deepEqual(summary.driftedMenus, []);
});

test("state lengkap bersih dan idempotent", () => {
  const menus = REQUIRED_MENUS.map(menuRow);
  const childMenus = menus.slice(1);
  const summary = summarizeProvisionState({
    menusByUrl: new Map(menus.map((menu) => [menu.url, menu])),
    roleMenusByMenuId: new Map(
      childMenus.map((menu, index) => [menu.id, roleMenuRow(menu, index + 1)]),
    ),
  });
  assert.deepEqual(summary.missingMenus, []);
  assert.deepEqual(summary.driftedMenus, []);
  assert.deepEqual(summary.missingAdminPermissions, []);
  assert.deepEqual(summary.preservedRestrictedAdminPermissions, []);
});

test("permission yang sudah ada tidak ditimpa dan dilaporkan jika dibatasi", () => {
  const menus = REQUIRED_MENUS.map(menuRow);
  const permissions = menus.slice(1).map((menu, index) => roleMenuRow(menu, index + 1));
  permissions[0] = {
    ...permissions[0],
    can_read: false,
    features: [],
  };
  const summary = summarizeProvisionState({
    menusByUrl: new Map(menus.map((menu) => [menu.url, menu])),
    roleMenusByMenuId: new Map(
      permissions.map((permission) => [permission.menu_id, permission]),
    ),
  });
  assert.deepEqual(summary.missingAdminPermissions, []);
  assert.deepEqual(summary.preservedRestrictedAdminPermissions, [
    REQUIRED_MENUS[1].url,
  ]);
});

test("drift metadata dan hierarchy terdeteksi tanpa mengubah URL", () => {
  const expected = REQUIRED_MENUS[1];
  const current = {
    ...menuRow(expected, 1),
    icon: "lucide lucide-circle",
    parent_id: "parent-lain",
  };
  assert.equal(menuNeedsUpdate(current, expected, "menu-root"), true);
  assert.throws(
    () =>
      assertApplyStateSafe({
        driftedMenus: [expected.url],
      }),
    /audit manual/,
  );
});

test("parent tidak menjadi jalur izin dan kebijakan Admin diterapkan pada child", () => {
  assert.equal(ADMIN_POLICY_BY_URL.has(REQUIRED_MENUS[0].url), false);
  const expected = permissionData(ADMIN_POLICY_BY_URL.get(REQUIRED_MENUS[1].url));
  assert.equal(expected.can_read, true);
  assert.equal(expected.features.length, 3);
  assert.equal(permissionMeetsPolicy(expected, expected), true);
  assert.equal(permissionMeetsPolicy({ ...expected, features: [] }, expected), false);
});
