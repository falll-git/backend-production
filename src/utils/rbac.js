const prisma = require("../config/prisma");

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function capabilityField(capability) {
  switch (capability) {
    case "create":
      return "can_create";
    case "update":
      return "can_update";
    case "delete":
      return "can_delete";
    case "read":
    default:
      return "can_read";
  }
}

async function resolveRequestUser(tokenUser) {
  if (!tokenUser?.id && !tokenUser?.role_id) return null;

  return prisma.users.findFirst({
    where: {
      ...(tokenUser.id ? { id: tokenUser.id } : {}),
      is_active: true,
    },
    select: {
      id: true,
      role_id: true,
      role: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
}

async function roleHasPermission(roleId, menuUrls, capability = "read") {
  const urls = asArray(menuUrls).filter(Boolean);
  if (!roleId || urls.length === 0) return false;

  const permission = await prisma.role_menus.findFirst({
    where: {
      role_id: roleId,
      [capabilityField(capability)]: true,
      menu: {
        url: {
          in: urls,
        },
      },
    },
  });

  return Boolean(permission);
}

async function roleHasFeature(roleId, menuUrls, feature) {
  const urls = asArray(menuUrls).filter(Boolean);
  const normalizedFeature = String(feature || "").trim();
  if (!roleId || urls.length === 0 || !normalizedFeature) return false;

  const permission = await prisma.role_menus.findFirst({
    where: {
      role_id: roleId,
      can_read: true,
      features: {
        has: normalizedFeature,
      },
      menu: {
        url: {
          in: urls,
        },
      },
    },
  });

  return Boolean(permission);
}

module.exports = {
  asArray,
  capabilityField,
  resolveRequestUser,
  roleHasFeature,
  roleHasPermission,
};
