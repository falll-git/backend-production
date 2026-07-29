const prisma = require("../../config/prisma");

const CREATOR_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
  division_id: true,
  division: {
    select: {
      name: true,
    },
  },
};

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

async function attachCreators(items) {
  const rows = Array.isArray(items) ? items : items ? [items] : [];
  const creatorIds = Array.from(
    new Set(rows.map((item) => item.created_by).filter(Boolean)),
  );
  const creators =
    creatorIds.length > 0
      ? await prisma.users.findMany({
          where: { id: { in: creatorIds } },
          select: CREATOR_SELECT,
        })
      : [];
  const creatorById = new Map(creators.map((user) => [user.id, user]));
  const enriched = rows.map((item) => ({
    ...item,
    creator: item.created_by ? creatorById.get(item.created_by) || null : null,
  }));
  return Array.isArray(items) ? enriched : enriched[0] || null;
}

async function findMany({ where, skip, take, orderBy }) {
  const items = await prisma.debtor_marketing_activities.findMany({
    where,
    skip,
    take,
    orderBy,
    include: INCLUDE,
  });
  return attachCreators(items);
}

function count(where) {
  return prisma.debtor_marketing_activities.count({ where });
}

async function findById(id, where = {}) {
  const item = await prisma.debtor_marketing_activities.findFirst({
    where: {
      id,
      ...where,
    },
    include: INCLUDE,
  });
  return attachCreators(item);
}

async function create(data) {
  const item = await prisma.debtor_marketing_activities.create({
    data,
    include: INCLUDE,
  });
  return attachCreators(item);
}

async function update(id, data) {
  const item = await prisma.debtor_marketing_activities.update({
    where: { id },
    data,
    include: INCLUDE,
  });
  return attachCreators(item);
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
