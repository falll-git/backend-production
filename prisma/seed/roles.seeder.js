const crypto = require("crypto");
const prisma = require("../../src/config/prisma");

const SEEDED_ROLE_NAMES = ["Admin", "Staf", "Supervisor", "Manager"];
const LEGACY_ROLE_RENAMES = [
  { from: "Manajer", to: "Manager" },
  { from: "Staff", to: "Staf" },
  { from: "IT", to: "Admin" },
];

function mergePermissions(current, next) {
  return {
    can_create: Boolean(current.can_create || next.can_create),
    can_read: Boolean(current.can_read || next.can_read),
    can_update: Boolean(current.can_update || next.can_update),
    can_delete: Boolean(current.can_delete || next.can_delete),
    features: [
      ...new Set([...(current.features || []), ...(next.features || [])]),
    ],
  };
}

function findRoleByName(name, client = prisma) {
  return client.roles.findFirst({
    where: {
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
  });
}

async function mergeRoleReferences(sourceRole, targetRole, client = prisma) {
  await client.users.updateMany({
    where: { role_id: sourceRole.id },
    data: { role_id: targetRole.id },
  });

  const sourceRoleMenus = await client.role_menus.findMany({
    where: { role_id: sourceRole.id },
  });

  for (const sourceRoleMenu of sourceRoleMenus) {
    const targetRoleMenu = await client.role_menus.findUnique({
      where: {
        role_id_menu_id: {
          role_id: targetRole.id,
          menu_id: sourceRoleMenu.menu_id,
        },
      },
    });

    if (targetRoleMenu) {
      await client.role_menus.update({
        where: { id: targetRoleMenu.id },
        data: mergePermissions(targetRoleMenu, sourceRoleMenu),
      });
      await client.role_menus.delete({ where: { id: sourceRoleMenu.id } });
    } else {
      await client.role_menus.update({
        where: { id: sourceRoleMenu.id },
        data: { role_id: targetRole.id },
      });
    }
  }

  await client.roles.delete({ where: { id: sourceRole.id } });
}

async function normalizeLegacyRole({ from, to }) {
  await prisma.$transaction(async (tx) => {
    const sourceRole = await findRoleByName(from, tx);
    if (!sourceRole) return;

    const targetRole = await findRoleByName(to, tx);
    if (!targetRole) {
      await tx.roles.update({
        where: { id: sourceRole.id },
        data: { name: to },
      });
      return;
    }

    if (sourceRole.id !== targetRole.id) {
      await mergeRoleReferences(sourceRole, targetRole, tx);
    }
  });
}

async function ensureRole(name) {
  const existing = await findRoleByName(name);

  if (existing) {
    return prisma.roles.update({
      where: { id: existing.id },
      data: { name },
    });
  }

  return prisma.roles.create({
    data: {
      id: crypto.randomUUID(),
      name,
    },
  });
}

async function seedRoles() {
  console.log("Seeding roles...");

  for (const legacyRole of LEGACY_ROLE_RENAMES) {
    await normalizeLegacyRole(legacyRole);
  }

  for (const name of SEEDED_ROLE_NAMES) {
    await ensureRole(name);
  }

  console.log("Roles seeded!");
}

module.exports = { seedRoles };
