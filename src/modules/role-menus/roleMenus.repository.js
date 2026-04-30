const prisma = require("../../config/prisma");

exports.findMany = ({ where, skip, take }) => {
  return prisma.role_menus.findMany({
    where,
    skip,
    take,
    orderBy: { id: "desc" },
    include: { role: true, menu: true },
  });
};

exports.count = (where) => {
  return prisma.role_menus.count({ where });
};

exports.findById = (id) => {
  return prisma.role_menus.findUnique({
    where: { id },
    include: { role: true, menu: true },
  });
};

exports.findByRoleAndMenu = (role_id, menu_id) => {
  return prisma.role_menus.findUnique({
    where: { role_id_menu_id: { role_id, menu_id } },
  });
};

exports.create = (data) => {
  return prisma.role_menus.create({
    data,
    include: { role: true, menu: true },
  });
};

exports.update = (id, data) => {
  return prisma.role_menus.update({
    where: { id },
    data,
    include: { role: true, menu: true },
  });
};

exports.delete = (id) => {
  return prisma.role_menus.delete({
    where: { id },
  });
};
