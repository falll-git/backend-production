const prisma = require("../../config/prisma");

exports.findMany = ({ where, skip, take }) => {
  return prisma.dispositions.findMany({
    where,
    skip,
    take,
    orderBy: { created_at: "desc" },
  });
};

exports.count = (where) => {
  return prisma.dispositions.count({ where });
};

exports.findById = (id) => {
  return prisma.dispositions.findUnique({ where: { id } });
};

exports.findByName = (name) => {
  return prisma.dispositions.findFirst({ where: { name } });
};

exports.create = (data) => {
  return prisma.dispositions.create({ data });
};

exports.update = (id, data) => {
  return prisma.dispositions.update({
    where: { id },
    data,
  });
};

exports.delete = (id) => {
  return prisma.dispositions.delete({
    where: { id },
  });
};
