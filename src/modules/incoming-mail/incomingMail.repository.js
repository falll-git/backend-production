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
  disposition_mails: {
    orderBy: [{ disposed_at: "asc" }, { id: "asc" }],
    include: {
      sender: { select: userSummarySelect },
      receiver: { select: userSummarySelect },
    },
  },
  letter_prioritie: true,
  storage: {
    include: storageInclude,
  },
  target_divisions: {
    orderBy: { created_at: "asc" },
    include: {
      division: true,
      manager: { select: userSummarySelect },
    },
  },
};

function loadById(id, client = prisma) {
  return client.incoming_mails.findUnique({
    where: { id },
    include: baseInclude,
  });
}

exports.findMany = ({ where, skip, take }) => {
  const query = {
    where,
    orderBy: [{ receive_date: "desc" }, { created_at: "desc" }],
    include: baseInclude,
  };

  if (typeof skip === "number") {
    query.skip = skip;
  }

  if (typeof take === "number") {
    query.take = take;
  }

  return prisma.incoming_mails.findMany(query);
};

exports.count = (where) => {
  return prisma.incoming_mails.count({ where });
};

exports.findById = (id) => {
  return prisma.incoming_mails.findFirst({
    where: { id, deleted_at: null },
    include: baseInclude,
  });
};

exports.createWithDisposition = async (
  data,
  dispositionsData,
  targetDivisionsData = [],
) => {
  const incomingMailId = data.id || crypto.randomUUID();
  let incomingMailCreated = false;

  try {
    await prisma.incoming_mails.create({
      data: {
        ...data,
        id: incomingMailId,
      },
    });
    incomingMailCreated = true;

    if (targetDivisionsData.length > 0) {
      await prisma.incoming_mail_target_divisions.createMany({
        data: targetDivisionsData.map((target) => ({
          ...target,
          incoming_mails_id: incomingMailId,
        })),
      });
    }

    if (dispositionsData.length > 0) {
      await prisma.incoming_mail_dispositions.createMany({
        data: dispositionsData.map((disposition) => ({
          ...disposition,
          incoming_mails_id: incomingMailId,
        })),
      });
    }
  } catch (error) {
    if (incomingMailCreated) {
      await prisma.incoming_mails
        .delete({
          where: { id: incomingMailId },
        })
        .catch(() => {});
    }

    throw error;
  }

  return loadById(incomingMailId);
};

exports.update = async (id, data) => {
  await prisma.incoming_mails.update({
    where: { id },
    data,
  });

  return loadById(id);
};

exports.delete = (id, deleted_by) => {
  return prisma.incoming_mails.update({
    where: { id },
    data: {
      deleted_by,
      deleted_at: new Date(),
    },
    include: baseInclude,
  });
};

exports.createDisposition = (data) => {
  return prisma.incoming_mail_dispositions.create({
    data,
    include: {
      sender: { select: userSummarySelect },
      receiver: { select: userSummarySelect },
    },
  });
};

exports.findDispositionById = ({ incomingMailId, dispositionId }) => {
  return prisma.incoming_mail_dispositions.findFirst({
    where: {
      id: dispositionId,
      incoming_mails_id: incomingMailId,
    },
    include: {
      sender: { select: userSummarySelect },
      receiver: { select: userSummarySelect },
    },
  });
};

exports.findCurrentDispositionForReceiver = ({
  incomingMailId,
  receiverId,
}) => {
  return prisma.incoming_mail_dispositions.findFirst({
    where: {
      incoming_mails_id: incomingMailId,
      receiver_id: receiverId,
      status: {
        in: ["NEW", "IN_PROGRESS"],
      },
    },
    orderBy: [{ disposed_at: "desc" }, { id: "desc" }],
    include: {
      sender: { select: userSummarySelect },
      receiver: { select: userSummarySelect },
    },
  });
};

exports.updateDisposition = (id, data) => {
  return prisma.incoming_mail_dispositions.update({
    where: { id },
    data,
  });
};

exports.forwardDispositionToReceivers = async ({
  incomingMailId,
  currentDispositionId,
  senderId,
  receiverIds,
  note,
  startDate,
  dueDate,
}) => {
  const createdDispositionIds = receiverIds.map(() => crypto.randomUUID());
  const previousDisposition = await prisma.incoming_mail_dispositions.findUnique({
    where: { id: currentDispositionId },
    select: {
      status: true,
      is_complete: true,
    },
  });
  let currentDispositionUpdated = false;
  let newDispositionsCreated = false;

  try {
    await prisma.incoming_mail_dispositions.update({
      where: { id: currentDispositionId },
      data: {
        status: "FORWARDED",
        is_complete: true,
      },
    });
    currentDispositionUpdated = true;

    await prisma.incoming_mail_dispositions.createMany({
      data: receiverIds.map((receiverId, index) => ({
        id: createdDispositionIds[index],
        incoming_mails_id: incomingMailId,
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

    await prisma.incoming_mails.update({
      where: { id: incomingMailId },
      data: { status: "IN_PROGRESS", updated_by: senderId },
    });
  } catch (error) {
    if (newDispositionsCreated) {
      await prisma.incoming_mail_dispositions
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
      await prisma.incoming_mail_dispositions
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

  return prisma.incoming_mail_dispositions.findMany({
    where: {
      id: {
        in: createdDispositionIds,
      },
    },
    orderBy: [{ disposed_at: "asc" }, { id: "asc" }],
    include: {
      sender: { select: userSummarySelect },
      receiver: { select: userSummarySelect },
    },
  });
};

exports.completeDispositions = (incomingMailId) => {
  return prisma.incoming_mail_dispositions.updateMany({
    where: {
      incoming_mails_id: incomingMailId,
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
