const prisma = require("../../config/prisma");

const baseInclude = {
  letter_prioritie: true,
  creator: true,
  updater: true,
  deleter: true,
};

function loadById(id) {
  return prisma.outgoing_mails.findUnique({
    where: { id },
    include: baseInclude,
  });
}

exports.findMany = ({ where, skip, take }) => {
  const query = {
    where,
    orderBy: [{ send_date: "desc" }, { created_at: "desc" }],
    include: baseInclude,
  };

  if (typeof skip === "number") {
    query.skip = skip;
  }

  if (typeof take === "number") {
    query.take = take;
  }

  return prisma.outgoing_mails.findMany(query);
};

exports.findById = (id) => {
  return prisma.outgoing_mails.findFirst({
    where: { id, deleted_at: null },
    include: baseInclude,
  });
};

exports.create = async (data) => {
  const outgoingMail = await prisma.outgoing_mails.create({
    data,
  });

  return loadById(outgoingMail.id);
};

exports.update = async (id, data) => {
  await prisma.outgoing_mails.update({
    where: { id },
    data,
  });

  return loadById(id);
};

exports.delete = async (id, deleted_by) => {
  await prisma.outgoing_mails.update({
    where: { id },
    data: {
      deleted_by,
      deleted_at: new Date(),
      status: "INACTIVE",
    },
  });

  return loadById(id);
};
