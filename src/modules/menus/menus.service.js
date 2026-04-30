const repository = require("./menus.repository");

function longestCommonPath(paths) {
  if (!paths.length) return "/dashboard";

  const segments = paths.map((path) => String(path || "").split("/").filter(Boolean));
  const minLength = Math.min(...segments.map((item) => item.length));
  const common = [];

  for (let index = 0; index < minLength; index += 1) {
    const current = segments[0][index];
    if (segments.every((item) => item[index] === current)) {
      common.push(current);
    } else {
      break;
    }
  }

  return common.length > 0 ? `/${common.join("/")}` : "/dashboard";
}

function normalizeMenuForResponse(menu, children) {
  const childUrls = children.map((item) => item.url).filter(Boolean);
  const url = menu.url || longestCommonPath(childUrls);

  return {
    ...menu,
    parent: menu.parent_label || menu.parent || null,
    children_snapshot: undefined,
    url,
    children,
  };
}

const buildMenuTree = (menus, parentId = null) => {
  return menus
    .filter((menu) => menu.parent_id === parentId)
    .map((menu) => {
      const children = buildMenuTree(menus, menu.id);
      return normalizeMenuForResponse(menu, children);
    });
};

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
    if (!parent) throw new Error("Parent menu not found");
    data.parent_label = data.parent_label || parent.name;
  }

  if (data.url === null || data.url === undefined) {
    data.url = "";
  }

  return data;
}

exports.getAllMenus = async () => {
  const menus = await repository.findMany();
  return buildMenuTree(menus, null);
};

exports.getMenuById = async (id) => {
  const menu = await repository.findById(id);
  if (!menu) throw new Error("Menu not found");
  return menu;
};

exports.createMenu = async (payload) => {
  return repository.create(await normalizeMenuPayload(payload));
};

exports.updateMenu = async (id, payload) => {
  const menu = await repository.findById(id);
  if (!menu) throw new Error("Menu not found");
  return repository.update(id, await normalizeMenuPayload(payload));
};

exports.deleteMenu = async (id) => {
  const menu = await repository.findById(id);
  if (!menu) throw new Error("Menu not found");
  return repository.delete(id);
};
