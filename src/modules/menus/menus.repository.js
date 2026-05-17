const prisma = require("../../config/prisma");

exports.findMany = () => {
  return prisma.menus.findMany({
    orderBy: { order: "asc" },
  });
};

exports.findById = (id) => {
  return prisma.menus.findUnique({
    where: { id },
  });
};

exports.findReadableMenuIdsByRoleId = async (roleId) => {
  const roleMenus = await prisma.role_menus.findMany({
    where: {
      role_id: roleId,
      can_read: true,
    },
    select: {
      menu_id: true,
    },
  });

  return roleMenus.map((item) => item.menu_id);
};

exports.findReadableRoleMenusByRoleId = async (roleId, menuWhere = {}) => {
  return prisma.role_menus.findMany({
    where: {
      role_id: roleId,
      can_read: true,
      menu: menuWhere,
    },
    include: {
      menu: true,
    },
  });
};

exports.create = (data) => {
  return prisma.menus.create({ data });
};

exports.update = (id, data) => {
  return prisma.menus.update({
    where: { id },
    data,
  });
};

exports.delete = (id) => {
  return prisma.menus.delete({
    where: { id },
  });
};
