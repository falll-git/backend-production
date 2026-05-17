const repository = require("./menus.repository");
const { AppError } = require("../../utils/errors");
const { serializeMenuAccess } = require("../../utils/menu-access");
const { resolveRequestUser } = require("../../utils/rbac");

const DASHBOARD_WIDGET_MENU_TYPE = "DASHBOARD_WIDGET";
const MAIN_REPORT_WIDGET_ORDER = {
  "dashboard.module_report.digital_archive": 10,
  "dashboard.module_report.correspondence": 20,
  "dashboard.module_report.debtor": 30,
  "dashboard.module_report.legal": 40,
};
const DASHBOARD_REPORT_SECTION_ORDER = {
  "dashboard.report.third_party_documents": 110,
  "dashboard.report.third_party_deposit_funds": 120,
  "dashboard.report.npf": 130,
  "dashboard.report.marketing_activity": 140,
};

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

function shouldRenderInSidebar(menu) {
  if (menu.render_in_sidebar === false) return false;
  if (menu.url) return true;
  return Array.isArray(menu.children) && menu.children.length > 0;
}

function getDashboardWidgetOrder(menu) {
  const mainReportOrder = MAIN_REPORT_WIDGET_ORDER[menu?.component_key];
  if (mainReportOrder) return mainReportOrder;
  const reportSectionOrder = DASHBOARD_REPORT_SECTION_ORDER[menu?.component_key];
  if (reportSectionOrder) return reportSectionOrder;
  return 1000 + (menu?.order ?? Number.MAX_SAFE_INTEGER - 1000);
}

const buildMenuTree = (menus, parentId = null, options = {}) => {
  const { sidebarOnly = false } = options;

  return menus
    .filter((menu) => menu.parent_id === parentId)
    .map((menu) => {
      const children = buildMenuTree(menus, menu.id, options);
      return normalizeMenuForResponse(menu, children);
    })
    .filter((menu) => !sidebarOnly || shouldRenderInSidebar(menu));
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

  if (data.component_key === "") {
    data.component_key = null;
  }

  if (data.menu_type === DASHBOARD_WIDGET_MENU_TYPE) {
    if (data.placement === undefined) {
      data.placement = "DASHBOARD";
    }

    if (data.render_in_sidebar === undefined) {
      data.render_in_sidebar = false;
    }
  }

  if (data.placement === "DASHBOARD" && data.render_in_sidebar === undefined) {
    data.render_in_sidebar = false;
  }

  return data;
}

exports.getAllMenus = async (requestUser) => {
  const menus = await repository.findMany();
  const access = await resolveMenuAccess(requestUser, menus);
  const visibleMenus = menus.filter((menu) => access.allowedMenuIds.has(menu.id));

  return buildMenuTree(visibleMenus, null, { sidebarOnly: true });
};

exports.getAllMenusForManagement = async () => {
  const menus = await repository.findMany();
  return buildMenuTree(menus, null);
};

exports.getDashboardWidgets = async (requestUser) => {
  const user = await resolveRequestUser(requestUser);
  if (!user) {
    throw new AppError("Sesi pengguna tidak valid.", 401);
  }

  const roleMenus = await repository.findReadableRoleMenusByRoleId(
    user.role_id,
    {
      menu_type: DASHBOARD_WIDGET_MENU_TYPE,
      placement: "DASHBOARD",
    },
  );

  return roleMenus
    .sort((left, right) => {
      const leftOrder = getDashboardWidgetOrder(left.menu);
      const rightOrder = getDashboardWidgetOrder(right.menu);
      return (
        leftOrder - rightOrder ||
        String(left.menu?.name || "").localeCompare(String(right.menu?.name || ""))
      );
    })
    .map((roleMenu) => ({
      ...serializeMenuAccess({
        ...roleMenu.menu,
        parent: roleMenu.menu.parent_label || null,
      }),
      role_permissions: {
        can_create: roleMenu.can_create,
        can_read: roleMenu.can_read,
        can_update: roleMenu.can_update,
        can_delete: roleMenu.can_delete,
        features: roleMenu.features,
      },
    }));
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
