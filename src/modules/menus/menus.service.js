const repository = require("./menus.repository");
const { AppError } = require("../../utils/errors");
const { serializeMenuAccess } = require("../../utils/menu-access");
const { resolveRequestUser } = require("../../utils/rbac");

function normalizeMenuForResponse(menu, children) {
  const url = typeof menu.url === "string" ? menu.url : "";

  return serializeMenuAccess({
    ...menu,
    parent: menu.parent_label || menu.parent || null,
    children_snapshot: undefined,
    url,
    children,
  });
}

const buildMenuTree = (menus, parentId = null) => {
  return menus
    .filter((menu) => menu.parent_id === parentId)
    .map((menu) => {
      const children = buildMenuTree(menus, menu.id);
      return normalizeMenuForResponse(menu, children);
    });
};

function includeAncestorMenuIds(menus, menuIds) {
  const menusById = new Map(menus.map((menu) => [menu.id, menu]));
  const allowedMenuIds = new Set(menuIds);

  for (const menuId of menuIds) {
    let current = menusById.get(menuId);

    while (current?.parent_id) {
      allowedMenuIds.add(current.parent_id);
      current = menusById.get(current.parent_id);
    }
  }

  return allowedMenuIds;
}

async function resolveMenuAccess(requestUser, menus) {
  const user = await resolveRequestUser(requestUser);
  if (!user) {
    throw new AppError("Sesi pengguna tidak valid.", 401);
  }

  const readableMenuIds = await repository.findReadableMenuIdsByRoleId(
    user.role_id,
  );

  return {
    user,
    allowedMenuIds: includeAncestorMenuIds(menus, readableMenuIds),
  };
}

async function normalizeMenuPayload(payload) {
  const data = { ...payload };

  if (data.parent !== undefined) {
    data.parent_label = data.parent || null;
    delete data.parent;
  }

  if (data.children !== undefined) {
    data.children_snapshot = data.children || null;
    delete data.children;
  }

  if (data.parent_id === "") {
    data.parent_id = null;
  }

  if (data.parent_id) {
    const parent = await repository.findById(data.parent_id);
    if (!parent) throw new Error("Menu induk tidak ditemukan.");
    data.parent_label = data.parent_label || parent.name;
  }

  if (data.url === null || data.url === undefined) {
    data.url = "";
  }

  return data;
}

exports.getAllMenus = async (requestUser) => {
  const menus = await repository.findMany();
  const access = await resolveMenuAccess(requestUser, menus);
  const visibleMenus = menus.filter((menu) => access.allowedMenuIds.has(menu.id));

  return buildMenuTree(visibleMenus, null);
};

exports.getAllMenusForManagement = async () => {
  const menus = await repository.findMany();
  return buildMenuTree(menus, null);
};

exports.getMenuById = async (id, requestUser) => {
  const menu = await repository.findById(id);
  if (!menu) throw new Error("Menu tidak ditemukan.");

  const menus = await repository.findMany();
  const access = await resolveMenuAccess(requestUser, menus);
  if (!access.allowedMenuIds.has(menu.id)) {
    throw new AppError("Anda tidak memiliki izin untuk melihat menu ini.", 403);
  }

  return serializeMenuAccess(menu);
};

exports.createMenu = async (payload) => {
  return serializeMenuAccess(
    await repository.create(await normalizeMenuPayload(payload)),
  );
};

exports.updateMenu = async (id, payload) => {
  const menu = await repository.findById(id);
  if (!menu) throw new Error("Menu tidak ditemukan.");
  return serializeMenuAccess(
    await repository.update(id, await normalizeMenuPayload(payload)),
  );
};

exports.deleteMenu = async (id) => {
  const menu = await repository.findById(id);
  if (!menu) throw new Error("Menu tidak ditemukan.");
  return repository.delete(id);
};
