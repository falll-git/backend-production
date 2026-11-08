const crypto = require("node:crypto");
const { Client } = require("pg");
const { loadEnv } = require("../src/config/env");
const {
  SEPUTAR_JAMINAN_ADMIN_POLICIES,
  SEPUTAR_JAMINAN_MENU_TREE,
} = require("../prisma/seed/seputar-jaminan-rbac.definition");

const APPLY_FLAG = "--apply";
const PROVISION_LOCK_KEY = "ruwang:seputar-jaminan-rbac:v1";

function flattenMenuTree(root) {
  return [
    {
      name: root.name,
      url: root.url,
      icon: root.icon || null,
      order: root.order ?? null,
      parentUrl: null,
      parentLabel: null,
    },
    ...(root.children || []).map((child) => ({
      name: child.name,
      url: child.url,
      icon: child.icon || null,
      order: child.order ?? null,
      parentUrl: root.url,
      parentLabel: root.name,
    })),
  ];
}

const REQUIRED_MENUS = Object.freeze(flattenMenuTree(SEPUTAR_JAMINAN_MENU_TREE));
const ADMIN_POLICY_BY_URL = new Map(
  SEPUTAR_JAMINAN_ADMIN_POLICIES.map((policy) => [policy.url, policy]),
);

function permissionData(policy) {
  const permissions = new Set(policy?.permissions || []);
  return {
    can_create: permissions.has("create"),
    can_read: permissions.has("read"),
    can_update: permissions.has("update"),
    can_delete: permissions.has("delete"),
    features: [...new Set(policy?.features || [])],
  };
}

function resolveProvisionDatabase(env = process.env, { apply = false } = {}) {
  let databaseUrl;
  try {
    databaseUrl = new URL(String(env.MIGRATION_DATABASE_URL || ""));
  } catch {
    throw new Error("MIGRATION_DATABASE_URL wajib berupa URL PostgreSQL valid.");
  }

  if (
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
    !databaseUrl.username ||
    !databaseUrl.password ||
    !databaseUrl.hostname ||
    databaseUrl.pathname.length <= 1
  ) {
    throw new Error(
      "MIGRATION_DATABASE_URL wajib memuat protocol, user, password, host, dan database.",
    );
  }

  const hostname = databaseUrl.hostname.toLowerCase();
  const isLoopback =
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.startsWith("127.");
  if (!isLoopback) {
    throw new Error(
      "Provisioning RBAC SJ ditolak: database harus diakses melalui loopback host.",
    );
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
  if (apply) {
    const allowed = String(env.SJ_RBAC_PROVISION_ALLOW || "").toLowerCase();
    const expectedDatabase = String(
      env.SJ_RBAC_PROVISION_TARGET_DATABASE || "",
    ).trim();
    if (allowed !== "true") {
      throw new Error(
        "Apply ditolak: SJ_RBAC_PROVISION_ALLOW=true wajib diatur secara eksplisit.",
      );
    }
    if (!expectedDatabase || expectedDatabase !== databaseName) {
      throw new Error(
        "Apply ditolak: SJ_RBAC_PROVISION_TARGET_DATABASE wajib sama persis dengan database tujuan.",
      );
    }
  }

  return {
    connectionString: databaseUrl.toString(),
    databaseName,
    hostname,
  };
}

function groupUniqueRows(rows, key, label) {
  const grouped = new Map();
  for (const row of rows) {
    const value = row[key];
    if (grouped.has(value)) {
      throw new Error(`${label} duplikat ditemukan: ${value}`);
    }
    grouped.set(value, row);
  }
  return grouped;
}

function menuNeedsUpdate(current, expected, parentId) {
  return (
    current.name !== expected.name ||
    current.icon !== expected.icon ||
    current.sort_order !== expected.order ||
    current.parent_id !== parentId ||
    current.parent_label !== expected.parentLabel ||
    current.menu_type !== "NAVIGATION" ||
    current.placement !== "SIDEBAR" ||
    current.render_in_sidebar !== true ||
    current.component_key !== null
  );
}

function permissionMeetsPolicy(current, expected) {
  const currentFeatures = new Set(current.features || []);
  return (
    (!expected.can_create || current.can_create) &&
    (!expected.can_read || current.can_read) &&
    (!expected.can_update || current.can_update) &&
    (!expected.can_delete || current.can_delete) &&
    expected.features.every((feature) => currentFeatures.has(feature))
  );
}

async function readProvisionState(client, { lockRows = false } = {}) {
  const lockClause = lockRows ? " FOR UPDATE" : "";
  const roleResult = await client.query(
    `SELECT id, name FROM roles WHERE name = 'Admin'${lockClause}`,
  );
  if (roleResult.rows.length !== 1) {
    throw new Error(
      `Role Admin harus tepat satu; ditemukan ${roleResult.rows.length}.`,
    );
  }

  const urls = REQUIRED_MENUS.map((menu) => menu.url);
  const menuResult = await client.query(
    `SELECT id, name, url, icon, "order" AS sort_order, parent_id,
            parent AS parent_label, menu_type, placement, render_in_sidebar,
            component_key
       FROM menus
      WHERE url = ANY($1::text[])${lockClause}`,
    [urls],
  );
  const menusByUrl = groupUniqueRows(menuResult.rows, "url", "URL menu");
  const menuIds = menuResult.rows.map((menu) => menu.id);
  const roleMenuResult = menuIds.length
    ? await client.query(
        `SELECT id, role_id, menu_id, can_create, can_read, can_update,
                can_delete, features
           FROM role_menus
          WHERE role_id = $1 AND menu_id = ANY($2::text[])${lockClause}`,
        [roleResult.rows[0].id, menuIds],
      )
    : { rows: [] };
  const roleMenusByMenuId = groupUniqueRows(
    roleMenuResult.rows,
    "menu_id",
    "Permission Admin untuk menu",
  );

  return {
    adminRole: roleResult.rows[0],
    menusByUrl,
    roleMenusByMenuId,
  };
}

function summarizeProvisionState(state) {
  const rootId = state.menusByUrl.get(SEPUTAR_JAMINAN_MENU_TREE.url)?.id || null;
  const missingMenus = [];
  const driftedMenus = [];
  const missingAdminPermissions = [];
  const preservedRestrictedAdminPermissions = [];

  for (const expected of REQUIRED_MENUS) {
    const current = state.menusByUrl.get(expected.url);
    const policy = ADMIN_POLICY_BY_URL.get(expected.url);
    if (!current) {
      missingMenus.push(expected.url);
      if (policy) missingAdminPermissions.push(expected.url);
      continue;
    }

    const expectedParentId = expected.parentUrl ? rootId : null;
    if (menuNeedsUpdate(current, expected, expectedParentId)) {
      driftedMenus.push(expected.url);
    }

    if (!policy) continue;

    const currentPermission = state.roleMenusByMenuId.get(current.id);
    if (!currentPermission) {
      missingAdminPermissions.push(expected.url);
      continue;
    }
    const expectedPermission = permissionData(policy);
    if (!permissionMeetsPolicy(currentPermission, expectedPermission)) {
      preservedRestrictedAdminPermissions.push(expected.url);
    }
  }

  return {
    missingMenus,
    driftedMenus,
    missingAdminPermissions,
    preservedRestrictedAdminPermissions,
  };
}

function assertApplyStateSafe(summary) {
  if (summary.driftedMenus.length > 0) {
    throw new Error(
      "Apply ditolak: metadata atau hierarchy menu SJ yang sudah ada berbeda; audit manual diperlukan.",
    );
  }
}

async function applyProvisioning(client) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      PROVISION_LOCK_KEY,
    ]);
    const initialState = await readProvisionState(client, { lockRows: true });
    assertApplyStateSafe(summarizeProvisionState(initialState));
    const menuIdsByUrl = new Map(
      [...initialState.menusByUrl.entries()].map(([url, menu]) => [url, menu.id]),
    );
    let menusCreated = 0;
    let adminPermissionsCreated = 0;

    for (const expected of REQUIRED_MENUS) {
      const parentId = expected.parentUrl
        ? menuIdsByUrl.get(expected.parentUrl)
        : null;
      if (expected.parentUrl && !parentId) {
        throw new Error(`Parent menu belum tersedia: ${expected.parentUrl}`);
      }

      const current = initialState.menusByUrl.get(expected.url);
      if (!current) {
        const id = crypto.randomUUID();
        await client.query(
          `INSERT INTO menus
           (id, name, url, icon, "order", parent_id, parent, menu_type,
              placement, render_in_sidebar, component_key, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'NAVIGATION', 'SIDEBAR', true,
                   NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            id,
            expected.name,
            expected.url,
            expected.icon,
            expected.order,
            parentId,
            expected.parentLabel,
          ],
        );
        menuIdsByUrl.set(expected.url, id);
        menusCreated += 1;
      } else {
        menuIdsByUrl.set(expected.url, current.id);
      }
    }

    for (const expected of REQUIRED_MENUS) {
      const policy = ADMIN_POLICY_BY_URL.get(expected.url);
      if (!policy) continue;
      const menuId = menuIdsByUrl.get(expected.url);
      const currentPermission = initialState.roleMenusByMenuId.get(menuId);
      if (currentPermission) continue;

      const permission = permissionData(policy);
      const result = await client.query(
        `INSERT INTO role_menus
           (id, role_id, menu_id, can_create, can_read, can_update, can_delete,
            features, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], CURRENT_TIMESTAMP,
                 CURRENT_TIMESTAMP)
         ON CONFLICT (role_id, menu_id) DO NOTHING`,
        [
          crypto.randomUUID(),
          initialState.adminRole.id,
          menuId,
          permission.can_create,
          permission.can_read,
          permission.can_update,
          permission.can_delete,
          permission.features,
        ],
      );
      adminPermissionsCreated += result.rowCount;
    }

    await client.query("COMMIT");
    return { menusCreated, adminPermissionsCreated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function provisionSeputarJaminanRbac({
  apply = false,
  env = process.env,
  ClientClass = Client,
} = {}) {
  const database = resolveProvisionDatabase(env, { apply });
  const client = new ClientClass({ connectionString: database.connectionString });
  await client.connect();
  try {
    const before = summarizeProvisionState(await readProvisionState(client));
    const changes = apply ? await applyProvisioning(client) : null;
    const after = apply
      ? summarizeProvisionState(await readProvisionState(client))
      : before;

    if (
      apply &&
      (after.missingMenus.length > 0 ||
        after.driftedMenus.length > 0 ||
        after.missingAdminPermissions.length > 0)
    ) {
      throw new Error("Verifikasi setelah provisioning RBAC SJ tidak bersih.");
    }

    return {
      status: "passed",
      mode: apply ? "apply" : "dry-run",
      database: database.databaseName,
      before,
      changes,
      after,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  loadEnv();
  const result = await provisionSeputarJaminanRbac({
    apply: process.argv.includes(APPLY_FLAG),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        status: "failed",
        reason: error instanceof Error ? error.message : "unknown_error",
      }),
    );
    process.exitCode = 1;
  });
}

module.exports = {
  ADMIN_POLICY_BY_URL,
  REQUIRED_MENUS,
  applyProvisioning,
  assertApplyStateSafe,
  flattenMenuTree,
  menuNeedsUpdate,
  permissionData,
  permissionMeetsPolicy,
  provisionSeputarJaminanRbac,
  readProvisionState,
  resolveProvisionDatabase,
  summarizeProvisionState,
};
