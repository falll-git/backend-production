const repository = require("./roleMenus.repository");
const roleRepository = require("../role/role.repository");
const menuRepository = require("../menus/menus.repository");
const { AppError } = require("../../utils/errors");

exports.getRoleMenus = async ({ page, limit, role_id }) => {
  const skip = (page - 1) * limit;

  const where = role_id ? { role_id } : {};

  const data = await repository.findMany({ where, skip, take: limit });
  const total = await repository.count(where);

  return {
    data,
    meta: {
      total,
      page,
      lastPage: Math.ceil(total / limit),
    },
  };
};

exports.getRoleMenuById = async (id) => {
  const roleMenu = await repository.findById(id);
  if (!roleMenu) throw new AppError("Role Menu not found", 404);
  return roleMenu;
};

exports.createRoleMenu = async (payload) => {
  const role = await roleRepository.findById(payload.role_id);
  const menu = await menuRepository.findById(payload.menu_id);

  if (!role) {
    throw new AppError("Role not found", 404);
  }

  if (!menu) {
    throw new AppError("Menu not found", 404);
  }

  const existing = await repository.findByRoleAndMenu(
    payload.role_id,
    payload.menu_id,
  );
  if (existing) {
    throw new AppError("This role already has access to this menu.", 409);
  }
  return repository.create(payload);
};

exports.updateRoleMenu = async (id, payload) => {
  const roleMenu = await repository.findById(id);
  if (!roleMenu) throw new AppError("Role Menu not found", 404);

  const nextRoleId = payload.role_id || roleMenu.role_id;
  const nextMenuId = payload.menu_id || roleMenu.menu_id;

  const role = await roleRepository.findById(nextRoleId);
  const menu = await menuRepository.findById(nextMenuId);

  if (!role) {
    throw new AppError("Role not found", 404);
  }

  if (!menu) {
    throw new AppError("Menu not found", 404);
  }

  if (payload.role_id || payload.menu_id) {
    const existing = await repository.findByRoleAndMenu(nextRoleId, nextMenuId);
    if (existing && existing.id !== id) {
      throw new AppError("This role already has access to this menu.", 409);
    }
  }

  return repository.update(id, payload);
};

exports.deleteRoleMenu = async (id) => {
  const roleMenu = await repository.findById(id);
  if (!roleMenu) throw new AppError("Role Menu not found", 404);
  return repository.delete(id);
};
