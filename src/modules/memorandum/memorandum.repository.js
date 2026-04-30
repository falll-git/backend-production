const prisma = require("../../config/prisma");

const baseInclude = {
  division: true,
  creator: true,
  updater: true,
  deleter: true,
  dispositions: {
    orderBy: [{ disposed_at: "asc" }, { id: "asc" }],
    include: {
      receiver: true,
      sender: true,
    },
  },
};

function loadById(id) {
  return prisma.memorandums.findUnique({
    where: { id },
    include: baseInclude,
  });
}

exports.findMany = ({ where, skip, take }) => {
  const query = {
    where,
    include: baseInclude,
    orderBy: [{ memo_date: "desc" }, { created_at: "desc" }],
  };

  if (typeof skip === "number") {
    query.skip = skip;
  }

  if (typeof take === "number") {
    query.take = take;
  }

  return prisma.memorandums.findMany(query);
};

exports.count = (where) => prisma.memorandums.count({ where });

exports.findById = (id) => {
  return prisma.memorandums.findFirst({
    where: { id, deleted_at: null },
    include: baseInclude,
  });
};

exports.createWithInitialReceivers = async (data, receiversData) => {
  const memorandum = await prisma.memorandums.create({
    data,
  });

  await prisma.memorandum_dispositions.createMany({
    data: receiversData.map((disposition) => ({
      memorandums_id: memorandum.id,
      receiver_id: disposition.receiver_id,
      sender_id: disposition.sender_id,
      parent_disposition_id: disposition.parent_disposition_id,
      due_date: disposition.due_date,
      start_date: disposition.start_date,
      note: disposition.note,
      status: disposition.status,
    })),
  });

  return loadById(memorandum.id);
};

exports.createDisposition = (data) => {
  return prisma.memorandum_dispositions.create({
    data,
    include: {
      receiver: true,
      sender: true,
    },
  });
};

exports.findDispositionById = ({ memorandumId, dispositionId }) => {
  return prisma.memorandum_dispositions.findFirst({
    where: {
      id: dispositionId,
      memorandums_id: memorandumId,
    },
    include: {
      receiver: true,
      sender: true,
    },
  });
};

exports.findCurrentDispositionForReceiver = ({ memorandumId, receiverId }) => {
  return prisma.memorandum_dispositions.findFirst({
    where: {
      memorandums_id: memorandumId,
      receiver_id: receiverId,
      status: {
        in: ["NEW", "IN_PROGRESS"],
      },
    },
    orderBy: [{ disposed_at: "desc" }, { id: "desc" }],
    include: {
      receiver: true,
      sender: true,
    },
  });
};

exports.updateDisposition = (id, data) => {
  return prisma.memorandum_dispositions.update({
    where: { id },
    data,
    include: {
      receiver: true,
      sender: true,
    },
  });
};

exports.update = async (id, data) => {
  await prisma.memorandums.update({
    where: { id },
    data,
  });

  return loadById(id);
};

exports.updateStoredFile = (id, file) => {
  return prisma.memorandums.update({
    where: { id },
    data: { file },
  });
};

exports.completeDispositions = (memorandumId) => {
  return prisma.memorandum_dispositions.updateMany({
    where: {
      memorandums_id: memorandumId,
      status: {
        in: ["NEW", "IN_PROGRESS"],
      },
    },
    data: {
      status: "COMPLETED",
      is_complete: true,
      completed_at: new Date(),
    },
  });
};

exports.delete = async (id, deleted_by) => {
  await prisma.memorandums.update({
    where: { id },
    data: {
      deleted_by,
      deleted_at: new Date(),
    },
  });

  return loadById(id);
};
