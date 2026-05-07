const prisma = require("../../config/prisma");

const userSummarySelect = {
  id: true,
  name: true,
  email: true,
  role_id: true,
  division_id: true,
  role: {
    select: {
      id: true,
      name: true,
      type: true,
    },
  },
  division: {
    select: {
      id: true,
      name: true,
    },
  },
};

const baseInclude = {
  origin_division: true,
  creator: { select: userSummarySelect },
  updater: { select: userSummarySelect },
  deleter: { select: userSummarySelect },
  target_divisions: {
    orderBy: { created_at: "asc" },
    include: {
      division: true,
      manager: { select: userSummarySelect },
    },
  },
  dispositions: {
    orderBy: [{ disposed_at: "asc" }, { id: "asc" }],
    include: {
      receiver: { select: userSummarySelect },
      sender: { select: userSummarySelect },
    },
  },
};

function loadById(id, client = prisma) {
  return client.memorandums.findUnique({
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

exports.findById = (id) => {
  return prisma.memorandums.findFirst({
    where: { id, deleted_at: null },
    include: baseInclude,
  });
};

exports.createWithInitialReceivers = async (
  data,
  receiversData,
  targetDivisionsData = [],
) => {
  return prisma.$transaction(async (tx) => {
    const memorandum = await tx.memorandums.create({
      data,
    });

    if (targetDivisionsData.length > 0) {
      await tx.memorandum_target_divisions.createMany({
        data: targetDivisionsData.map((target) => ({
          ...target,
          memorandums_id: memorandum.id,
        })),
      });
    }

    await tx.memorandum_dispositions.createMany({
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

    return loadById(memorandum.id, tx);
  });
};

exports.createDisposition = (data) => {
  return prisma.memorandum_dispositions.create({
    data,
    include: {
      receiver: { select: userSummarySelect },
      sender: { select: userSummarySelect },
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
      receiver: { select: userSummarySelect },
      sender: { select: userSummarySelect },
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
      receiver: { select: userSummarySelect },
      sender: { select: userSummarySelect },
    },
  });
};

exports.updateDisposition = (id, data) => {
  return prisma.memorandum_dispositions.update({
    where: { id },
    data,
    include: {
      receiver: { select: userSummarySelect },
      sender: { select: userSummarySelect },
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
