const prisma = require("../../config/prisma");

const ACTOR_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
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

const INCLUDE_ACTOR = {
  actor: {
    select: ACTOR_SELECT,
  },
};

exports.findMany = ({ where, skip, take, orderBy }) =>
  prisma.system_activity_logs.findMany({
    where,
    skip,
    take,
    orderBy,
    include: INCLUDE_ACTOR,
  });

exports.findAll = ({ where, orderBy }) =>
  prisma.system_activity_logs.findMany({
    where,
    orderBy,
    include: INCLUDE_ACTOR,
  });

exports.findById = (id) =>
  prisma.system_activity_logs.findUnique({
    where: { id },
    include: INCLUDE_ACTOR,
  });

exports.count = (where) => prisma.system_activity_logs.count({ where });

exports.groupByModule = (where) =>
  prisma.system_activity_logs.groupBy({
    by: ["module"],
    where,
    _count: { id: true },
    orderBy: { module: "asc" },
  });

exports.groupByAction = (where) =>
  prisma.system_activity_logs.groupBy({
    by: ["action"],
    where,
    _count: { id: true },
    orderBy: { action: "asc" },
  });

exports.distinctOptions = () =>
  prisma.system_activity_logs.findMany({
    distinct: ["module", "action", "source", "entity_type"],
    select: {
      module: true,
      action: true,
      source: true,
      entity_type: true,
    },
  });

exports.distinctActors = () =>
  prisma.system_activity_logs.findMany({
    where: { actor_id: { not: null } },
    distinct: ["actor_id"],
    orderBy: { created_at: "desc" },
    select: {
      actor_id: true,
      actor: {
        select: ACTOR_SELECT,
      },
    },
  });
