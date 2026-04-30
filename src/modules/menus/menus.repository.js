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
