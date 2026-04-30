const prisma = require("../../config/prisma");

exports.findMany = ({ where, skip, take }) => {
  return prisma.letter_priorities.findMany({
    where,
    skip,
    take,
    orderBy: { id: "desc" },
  });
};

exports.count = (where) => {
  return prisma.letter_priorities.count({ where });
};

exports.findById = (id) => {
  return prisma.letter_priorities.findUnique({ where: { id } });
};

exports.findByName = (name) => {
  return prisma.letter_priorities.findFirst({
    where: {
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
  });
};

exports.findDependencySummary = (id) => {
  return prisma.letter_priorities.findUnique({
    where: { id },
    select: {
      id: true,
      _count: {
        select: {
          incoming_mails: true,
          outgoing_mails: true,
        },
      },
    },
  });
};

exports.create = (data) => {
  return prisma.letter_priorities.create({ data });
};

exports.update = (id, data) => {
  return prisma.letter_priorities.update({
    where: { id },
    data,
  });
};

exports.delete = (id) => {
  return prisma.letter_priorities.delete({
    where: { id },
  });
};
