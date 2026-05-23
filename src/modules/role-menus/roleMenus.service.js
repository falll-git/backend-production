const repository = require("./roleMenus.repository");
const roleRepository = require("../role/role.repository");
const menuRepository = require("../menus/menus.repository");
const { AppError } = require("../../utils/errors");
const {
  assertMenuFeaturesAllowed,
  assertMenuPermissionAllowed,
  normalizeFeatures,
  normalizeMenuFeatures,
  serializeMenuAccess,
} = require("../../utils/menu-access");
const { resolveRequestUser, roleHasPermission } = require("../../utils/rbac");
const { serializeRole } = require("../../utils/role-types");
const { buildPaginationMeta } = require("../../utils/pagination");

const ROLE_MENU_ADMIN_URL = "/dashboard/parameter/role-menu";

function serializeRoleMenu(roleMenu) {
  return {
    ...roleMenu,
    features: normalizeMenuFeatures(roleMenu.menu, roleMenu.features),
    role: serializeRole(roleMenu.role),
    menu: serializeMenuAccess(roleMenu.menu),
  };
}

function mergePermissionPayload(current, payload) {
  return {
    can_create: payload.can_create ?? current?.can_create ?? false,
    can_read: payload.can_read ?? current?.can_read ?? false,
    can_update: payload.can_update ?? current?.can_update ?? false,
    can_delete: payload.can_delete ?? current?.can_delete ?? false,
    features:
      payload.features !== undefined
        ? normalizeFeatures(payload.features)
        : normalizeFeatures(current?.features),
  };
}

function assertReadEnabledForWrite(permission) {
  const hasWritePermission =
    permission.can_create || permission.can_update || permission.can_delete;

  if (hasWritePermission && !permission.can_read) {
    throw new AppError(
      "Hak akses baca wajib aktif jika hak akses tambah, ubah, atau hapus aktif.",
      422,
    );
  }
}

function assertReadEnabledForFeatures(permission) {
  if (permission.features.length > 0 && !permission.can_read) {
    throw new AppError("Hak akses baca wajib aktif jika fitur tambahan aktif.", 422);
  }
}

function validatePermission(menu, permission) {
  assertMenuPermissionAllowed(menu, permission);
  assertMenuFeaturesAllowed(menu, permission.features);
  assertReadEnabledForWrite(permission);
  assertReadEnabledForFeatures(permission);
}

async function resolveReadScope(requestUser, requestedRoleId = null) {
  const user = await resolveRequestUser(requestUser);
  if (!user) {
    throw new AppError("Sesi pengguna tidak valid.", 401);
  }

  const canManageRoleMenus = await roleHasPermission(
    user.role_id,
    ROLE_MENU_ADMIN_URL,
    "read",
  );

  if (canManageRoleMenus) {
    return {
      user,
      role_id: requestedRoleId || null,
      canManageRoleMenus,
    };
  }

  if (requestedRoleId && requestedRoleId !== user.role_id) {
    throw new AppError("Anda tidak memiliki izin untuk melihat pengaturan akses role ini.", 403);
  }

  return {
    user,
    role_id: user.role_id,
    canManageRoleMenus,
  };
}

exports.getRoleMenus = async ({ pagination, role_id, requestUser }) => {
  const scope = await resolveReadScope(requestUser, role_id);

  const where = scope.role_id ? { role_id: scope.role_id } : {};

  const data = await repository.findMany({
    where,
    skip: pagination.skip,
    take: pagination.take,
  });
  const total = await repository.count(where);

  return {
    data: data.map(serializeRoleMenu),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getRoleMenuById = async (id, requestUser) => {
  const roleMenu = await repository.findById(id);
  if (!roleMenu) throw new AppError("Pengaturan akses role tidak ditemukan.", 404);

  const scope = await resolveReadScope(requestUser, roleMenu.role_id);
  if (!scope.canManageRoleMenus && roleMenu.role_id !== scope.user.role_id) {
    throw new AppError("Anda tidak memiliki izin untuk melihat pengaturan akses role ini.", 403);
  }

  return serializeRoleMenu(roleMenu);
};

exports.createRoleMenu = async (payload) => {
  const role = await roleRepository.findById(payload.role_id);
  const menu = await menuRepository.findById(payload.menu_id);

  if (!role) {
    throw new AppError("Role tidak ditemukan.", 404);
  }

  if (!menu) {
    throw new AppError("Menu tidak ditemukan.", 404);
  }

  const permission = mergePermissionPayload(null, payload);
  validatePermission(menu, permission);

  const existing = await repository.findByRoleAndMenu(
    payload.role_id,
    payload.menu_id,
  );
  if (existing) {
    throw new AppError("Role ini sudah memiliki pengaturan akses untuk menu tersebut.", 409);
  }
  return serializeRoleMenu(
    await repository.create({
      ...payload,
      ...permission,
    }),
  );
};

exports.updateRoleMenu = async (id, payload) => {
  const roleMenu = await repository.findById(id);
  if (!roleMenu) throw new AppError("Pengaturan akses role tidak ditemukan.", 404);

  const nextRoleId = payload.role_id || roleMenu.role_id;
  const nextMenuId = payload.menu_id || roleMenu.menu_id;

  const role = await roleRepository.findById(nextRoleId);
  const menu = await menuRepository.findById(nextMenuId);

  if (!role) {
    throw new AppError("Role tidak ditemukan.", 404);
  }

  if (!menu) {
    throw new AppError("Menu tidak ditemukan.", 404);
  }

  const permission = mergePermissionPayload(roleMenu, payload);
  validatePermission(menu, permission);

  if (payload.role_id || payload.menu_id) {
    const existing = await repository.findByRoleAndMenu(nextRoleId, nextMenuId);
    if (existing && existing.id !== id) {
      throw new AppError("Role ini sudah memiliki pengaturan akses untuk menu tersebut.", 409);
    }
  }

  const updatePayload = { ...payload };
  if (payload.features !== undefined) {
    updatePayload.features = permission.features;
  }

  return serializeRoleMenu(await repository.update(id, updatePayload));
};

exports.deleteRoleMenu = async (id) => {
  const roleMenu = await repository.findById(id);
  if (!roleMenu) throw new AppError("Pengaturan akses role tidak ditemukan.", 404);
  return repository.delete(id);
};
