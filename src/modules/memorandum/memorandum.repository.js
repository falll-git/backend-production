const crypto = require("crypto");
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
    },
  },
  division: {
    select: {
      id: true,
      name: true,
    },
  },
};

const storageInclude = {
  cabinet: {
    include: {
      office: true,
    },
  },
};

const baseInclude = {
  origin_division: true,
  storage: {
    include: storageInclude,
  },
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

exports.count = (where) => {
  return prisma.memorandums.count({ where });
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
  const memorandumId = data.id || crypto.randomUUID();
  let memorandumCreated = false;

  try {
    await prisma.memorandums.create({
      data: {
        ...data,
        id: memorandumId,
      },
    });
    memorandumCreated = true;

    if (targetDivisionsData.length > 0) {
      await prisma.memorandum_target_divisions.createMany({
        data: targetDivisionsData.map((target) => ({
          ...target,
          memorandums_id: memorandumId,
        })),
      });
    }

    if (receiversData.length > 0) {
      await prisma.memorandum_dispositions.createMany({
        data: receiversData.map((disposition) => ({
          memorandums_id: memorandumId,
          receiver_id: disposition.receiver_id,
          sender_id: disposition.sender_id,
          parent_disposition_id: disposition.parent_disposition_id,
          due_date: disposition.due_date,
          start_date: disposition.start_date,
          note: disposition.note,
          status: disposition.status,
        })),
      });
    }
  } catch (error) {
    if (memorandumCreated) {
      await prisma.memorandums
        .delete({
          where: { id: memorandumId },
        })
        .catch(() => {});
    }

    throw error;
  }

  return loadById(memorandumId);
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
  });
};

exports.forwardDispositionToReceivers = async ({
  memorandumId,
  currentDispositionId,
  senderId,
  receiverIds,
  note,
  startDate,
  dueDate,
}) => {
  const createdDispositionIds = receiverIds.map(() => crypto.randomUUID());
  const previousDisposition = await prisma.memorandum_dispositions.findUnique({
    where: { id: currentDispositionId },
    select: {
      status: true,
      is_complete: true,
    },
  });
  let currentDispositionUpdated = false;
  let newDispositionsCreated = false;

  try {
    await prisma.memorandum_dispositions.update({
      where: { id: currentDispositionId },
      data: {
        status: "FORWARDED",
        is_complete: true,
      },
    });
    currentDispositionUpdated = true;

    await prisma.memorandum_dispositions.createMany({
      data: receiverIds.map((receiverId, index) => ({
        id: createdDispositionIds[index],
        memorandums_id: memorandumId,
        sender_id: senderId,
        receiver_id: receiverId,
        parent_disposition_id: currentDispositionId,
        note,
        start_date: startDate,
        due_date: dueDate,
        status: startDate ? "IN_PROGRESS" : "NEW",
      })),
    });
    newDispositionsCreated = true;

    await prisma.memorandums.update({
      where: { id: memorandumId },
      data: { status: "IN_PROGRESS", updated_by: senderId },
    });
  } catch (error) {
    if (newDispositionsCreated) {
      await prisma.memorandum_dispositions
        .deleteMany({
          where: {
            id: {
              in: createdDispositionIds,
            },
          },
        })
        .catch(() => {});
    }

    if (currentDispositionUpdated && previousDisposition) {
      await prisma.memorandum_dispositions
        .update({
          where: { id: currentDispositionId },
          data: {
            status: previousDisposition.status,
            is_complete: previousDisposition.is_complete,
          },
        })
        .catch(() => {});
    }

    throw error;
  }

  return prisma.memorandum_dispositions.findMany({
    where: {
      id: {
        in: createdDispositionIds,
      },
    },
    orderBy: [{ disposed_at: "asc" }, { id: "asc" }],
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
