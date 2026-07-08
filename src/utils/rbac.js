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

const ROLE_PERMISSION_FIELDS = [
  "can_create",
  "can_read",
  "can_update",
  "can_delete",
];

function rolePermissionsCover(actorPermissions, targetPermissions) {
  const actorByMenu = new Map(
    (actorPermissions || []).map((permission) => [
      permission.menu_id,
      permission,
    ]),
  );

  return (targetPermissions || []).every((targetPermission) => {
    const actorPermission = actorByMenu.get(targetPermission.menu_id);

    const capabilitiesCovered = ROLE_PERMISSION_FIELDS.every(
      (field) => !targetPermission[field] || actorPermission?.[field] === true,
    );
    if (!capabilitiesCovered) return false;

    const actorFeatures = new Set(actorPermission?.features || []);
    return (targetPermission.features || []).every((feature) =>
      actorFeatures.has(feature),
    );
  });
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
      can_access_restricted_documents: true,
      role: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
}

async function roleCanGrantRole(actorRoleId, targetRoleId) {
  if (!actorRoleId || !targetRoleId) return false;
  if (actorRoleId === targetRoleId) return true;

  const select = {
    menu_id: true,
    can_create: true,
    can_read: true,
    can_update: true,
    can_delete: true,
    features: true,
  };
  const [actorPermissions, targetPermissions] = await Promise.all([
    prisma.role_menus.findMany({
      where: { role_id: actorRoleId },
      select,
    }),
    prisma.role_menus.findMany({
      where: { role_id: targetRoleId },
      select,
    }),
  ]);

  return rolePermissionsCover(actorPermissions, targetPermissions);
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
  roleCanGrantRole,
  roleHasFeature,
  roleHasPermission,
  rolePermissionsCover,
};
