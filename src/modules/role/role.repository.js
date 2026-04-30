const prisma = require("../../config/prisma");

exports.findMany = ({ where, skip, take }) => {
  return prisma.roles.findMany({
    where,
    skip,
    take,
    orderBy: { id: "desc" },
  });
};

exports.count = (where) => {
  return prisma.roles.count({ where });
};

exports.findById = (id) => {
  return prisma.roles.findUnique({ where: { id } });
};

exports.findByName = (name) => {
  return prisma.roles.findFirst({
    where: {
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
  });
};

exports.findDependencySummary = (id) => {
  return prisma.roles.findUnique({
    where: { id },
    select: {
      id: true,
      _count: {
        select: {
          users: true,
          roles_menus: true,
        },
      },
    },
  });
};

exports.create = (data) => {
  return prisma.roles.create({ data });
};

exports.update = (id, data) => {
  return prisma.roles.update({
    where: { id },
    data,
  });
};

exports.delete = (id) => {
  return prisma.roles.delete({
    where: { id },
  });
};
