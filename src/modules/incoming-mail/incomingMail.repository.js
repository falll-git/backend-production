const prisma = require("../../config/prisma");

const userSummarySelect = {
  id: true,
  name: true,
  email: true,
  role_id: true,
  division_id: true,
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
  division: true,
};

function loadById(id) {
  return prisma.incoming_mails.findUnique({
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

exports.count = (where) => prisma.incoming_mails.count({ where });

exports.findById = (id) => {
  return loadById(id);
};

exports.createWithDisposition = async (data, dispositionsData) => {
  const incomingMail = await prisma.incoming_mails.create({
    data,
  });

  await prisma.incoming_mail_dispositions.createMany({
    data: dispositionsData.map((disposition) => ({
      ...disposition,
      incoming_mails_id: incomingMail.id,
    })),
  });

  return loadById(incomingMail.id);
};

exports.update = async (id, data) => {
  await prisma.incoming_mails.update({
    where: { id },
    data,
  });

  return loadById(id);
};

exports.updateStoredFile = (id, file) => {
  return prisma.incoming_mails.update({
    where: { id },
    data: { file },
  });
};

exports.delete = (id) => {
  return prisma.incoming_mails.delete({
    where: { id },
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
