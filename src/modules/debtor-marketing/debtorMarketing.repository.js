const prisma = require("../../config/prisma");

const INCLUDE = {
  debtor: {
    select: {
      id: true,
      debtor_number: true,
      identity_number: true,
      name: true,
      status: true,
    },
  },
  contract: {
    select: {
      id: true,
      no_kontrak: true,
      status: true,
    },
  },
  timeline: true,
  related_activity: {
    select: {
      id: true,
      activity_kind: true,
      debtor_id: true,
      contract_id: true,
      timeline_id: true,
      timeline_group_id: true,
      activity_date: true,
      target_date: true,
      status: true,
      action_plan: true,
      visit_result: true,
      handling_step: true,
    },
  },
  files: true,
};

function findMany({ where, skip, take, orderBy }) {
  return prisma.debtor_marketing_activities.findMany({
    where,
    skip,
    take,
    orderBy,
    include: INCLUDE,
  });
}

function count(where) {
  return prisma.debtor_marketing_activities.count({ where });
}

function findById(id, where = {}) {
  return prisma.debtor_marketing_activities.findFirst({
    where: {
      id,
      ...where,
    },
    include: INCLUDE,
  });
}

function create(data) {
  return prisma.debtor_marketing_activities.create({ data, include: INCLUDE });
}

function update(id, data) {
  return prisma.debtor_marketing_activities.update({
    where: { id },
    data,
    include: INCLUDE,
  });
}

function findDebtorById(id) {
  return prisma.digital_debtors.findFirst({ where: { id, deleted_at: null } });
}

function findDebtorByIdWithWhere(id, where = {}) {
  return prisma.digital_debtors.findFirst({
    where: {
      id,
      deleted_at: null,
      ...where,
    },
  });
}

function findContractById(id) {
  return prisma.debtor_contracts.findFirst({ where: { id, deleted_at: null } });
}

function findTimelineById(id) {
  return prisma.debtor_marketing_timelines.findFirst({
    where: { id, deleted_at: null },
  });
}

function findTimelineByGroupKey(groupKey) {
  return prisma.debtor_marketing_timelines.findFirst({
    where: { group_key: groupKey, deleted_at: null },
  });
}

function createTimeline(data) {
  return prisma.debtor_marketing_timelines.create({ data });
}

function updateTimeline(id, data) {
  return prisma.debtor_marketing_timelines.update({
    where: { id },
    data,
  });
}

module.exports = {
  count,
  create,
  createTimeline,
  findById,
  findContractById,
  findDebtorById,
  findDebtorByIdWithWhere,
  findMany,
  findTimelineByGroupKey,
  findTimelineById,
  update,
  updateTimeline,
};
