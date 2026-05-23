const crypto = require("crypto");
const prisma = require("../src/config/prisma");
const {
  ROLE_MENU_POLICIES,
  SEEDED_ROLES,
  buildPermission,
} = require("../prisma/seed/role_menus.seeder");

const APPLY_FLAG = "--apply";
const shouldApply = process.argv.includes(APPLY_FLAG);

function permissionKey(roleId, menuId) {
  return `${roleId}:${menuId}`;
}

function serializePermission(permission) {
  return {
    can_create: Boolean(permission.can_create),
    can_read: Boolean(permission.can_read),
    can_update: Boolean(permission.can_update),
    can_delete: Boolean(permission.can_delete),
    features: [...new Set(permission.features || [])].sort(),
  };
}

function permissionsEqual(left, right) {
  return JSON.stringify(serializePermission(left)) === JSON.stringify(serializePermission(right));
}

function mergePermissions(current, next) {
  const features = [...new Set([...(current?.features || []), ...(next.features || [])])];

  return {
    can_create: Boolean(current?.can_create || next.can_create),
    can_read: Boolean(current?.can_read || next.can_read),
    can_update: Boolean(current?.can_update || next.can_update),
    can_delete: Boolean(current?.can_delete || next.can_delete),
    features,
  };
}

function addPermission(store, roleId, menuId, permissionValue) {
  const key = permissionKey(roleId, menuId);
  store.set(key, {
    role_id: roleId,
    menu_id: menuId,
    ...mergePermissions(store.get(key), permissionValue),
  });
}

function addParentReadPermissions(store, menu, menusById, roleId) {
  let parentId = menu.parent_id;

  while (parentId) {
    const parent = menusById.get(parentId);
    if (!parent) return;

    addPermission(store, roleId, parent.id, buildPermission({ permissions: ["read"] }));
    parentId = parent.parent_id;
  }
}

async function buildExpectedRoleMenus() {
  const menus = await prisma.menus.findMany();
  const roles = await prisma.roles.findMany({
    where: {
      name: {
        in: SEEDED_ROLES,
      },
    },
  });
  const menusByUrl = new Map(
    menus.filter((menu) => menu.url).map((menu) => [menu.url, menu]),
  );
  const menusById = new Map(menus.map((menu) => [menu.id, menu]));
  const rolesByName = new Map(roles.map((role) => [role.name, role]));
  const missingRoles = SEEDED_ROLES.filter((roleName) => !rolesByName.has(roleName));

  if (missingRoles.length > 0) {
    throw new Error(`Role tidak ditemukan: ${missingRoles.join(", ")}`);
  }

  const expected = new Map();

  for (const [roleName, policies] of Object.entries(ROLE_MENU_POLICIES)) {
    const role = rolesByName.get(roleName);

    for (const policy of policies) {
      const menu = menusByUrl.get(policy.url);
      if (!menu) {
        throw new Error(`Menu tidak ditemukan: ${policy.url}`);
      }

      addPermission(expected, role.id, menu.id, buildPermission(policy));
      addParentReadPermissions(expected, menu, menusById, role.id);
    }
  }

  return {
    expected,
    managedRoleIds: roles.map((role) => role.id),
    menuNameById: new Map(menus.map((menu) => [menu.id, menu.name])),
    roleNameById: new Map(roles.map((role) => [role.id, role.name])),
  };
}

function describeChange(action, item, { roleNameById, menuNameById }) {
  const roleName = roleNameById.get(item.role_id) || item.role_id;
  const menuName = menuNameById.get(item.menu_id) || item.menu_id;
  return `${action}: ${roleName} -> ${menuName}`;
}

async function main() {
  const { expected, managedRoleIds, menuNameById, roleNameById } =
    await buildExpectedRoleMenus();
  const existing = await prisma.role_menus.findMany({
    where: {
      role_id: {
        in: managedRoleIds,
      },
    },
  });
  const existingByKey = new Map(
    existing.map((item) => [permissionKey(item.role_id, item.menu_id), item]),
  );
  const expectedKeys = new Set(expected.keys());
  const creates = [];
  const updates = [];
  const deletes = [];

  for (const [key, item] of expected.entries()) {
    const current = existingByKey.get(key);
    if (!current) {
      creates.push(item);
      continue;
    }

    if (!permissionsEqual(current, item)) {
      updates.push({ id: current.id, ...item });
    }
  }

  for (const [key, item] of existingByKey.entries()) {
    if (!expectedKeys.has(key)) {
      deletes.push(item);
    }
  }

  const context = { roleNameById, menuNameById };
  console.log(
    `[role-menu-baseline] mode=${shouldApply ? "apply" : "dry-run"} create=${creates.length} update=${updates.length} delete=${deletes.length}`,
  );

  for (const item of creates.slice(0, 30)) {
    console.log(describeChange("create", item, context));
  }
  for (const item of updates.slice(0, 30)) {
    console.log(describeChange("update", item, context));
  }
  for (const item of deletes.slice(0, 30)) {
    console.log(describeChange("delete", item, context));
  }

  if (!shouldApply) {
    console.log(`[role-menu-baseline] Tidak ada perubahan disimpan. Jalankan dengan ${APPLY_FLAG} untuk apply.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const item of creates) {
      await tx.role_menus.create({
        data: {
          id: crypto.randomUUID(),
          role_id: item.role_id,
          menu_id: item.menu_id,
          can_create: item.can_create,
          can_read: item.can_read,
          can_update: item.can_update,
          can_delete: item.can_delete,
          features: item.features,
        },
      });
    }

    for (const item of updates) {
      await tx.role_menus.update({
        where: { id: item.id },
        data: {
          can_create: item.can_create,
          can_read: item.can_read,
          can_update: item.can_update,
          can_delete: item.can_delete,
          features: item.features,
        },
      });
    }

    for (const item of deletes) {
      await tx.role_menus.delete({ where: { id: item.id } });
    }
  });

  console.log("[role-menu-baseline] Baseline role menu berhasil disinkronkan.");
}

main()
  .catch((error) => {
    console.error("[role-menu-baseline] Gagal sinkron role menu baseline:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
