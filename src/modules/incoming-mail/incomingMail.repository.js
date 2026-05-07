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
  disposition_mails: {
    orderBy: [{ disposed_at: "asc" }, { id: "asc" }],
    include: {
      sender: { select: userSummarySelect },
      receiver: { select: userSummarySelect },
    },
  },
  letter_prioritie: true,
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
  return prisma.$transaction(async (tx) => {
    const incomingMail = await tx.incoming_mails.create({
      data,
    });

    if (targetDivisionsData.length > 0) {
      await tx.incoming_mail_target_divisions.createMany({
        data: targetDivisionsData.map((target) => ({
          ...target,
          incoming_mails_id: incomingMail.id,
        })),
      });
    }

    await tx.incoming_mail_dispositions.createMany({
      data: dispositionsData.map((disposition) => ({
        ...disposition,
        incoming_mails_id: incomingMail.id,
      })),
    });

    return loadById(incomingMail.id, tx);
  });
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
