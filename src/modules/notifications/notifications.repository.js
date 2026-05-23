const prisma = require("../../config/prisma");

const USER_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
};

const notificationInclude = {
  recipient: {
    select: USER_SELECT,
  },
  creator: {
    select: USER_SELECT,
  },
};

function findMany({ where, skip, take }) {
  return prisma.notifications.findMany({
    where,
    skip,
    take,
    orderBy: {
      created_at: "desc",
    },
    include: notificationInclude,
  });
}

function count(where) {
  return prisma.notifications.count({ where });
}

function countUnread(recipientId) {
  return prisma.notifications.count({
    where: {
      recipient_id: recipientId,
      read_at: null,
      deleted_at: null,
    },
  });
}

function findByIdForRecipient(id, recipientId) {
  return prisma.notifications.findFirst({
    where: {
      id,
      recipient_id: recipientId,
      deleted_at: null,
    },
    include: notificationInclude,
  });
}

function findByDedupeKey(dedupeKey) {
  if (!dedupeKey) return null;

  return prisma.notifications.findUnique({
    where: {
      dedupe_key: dedupeKey,
    },
    include: notificationInclude,
  });
}

async function create(data) {
  return prisma.notifications.create({
    data,
    include: notificationInclude,
  });
}

function update(id, data) {
  return prisma.notifications.update({
    where: { id },
    data,
    include: notificationInclude,
  });
}

function markRead(id, recipientId) {
  return prisma.notifications.updateMany({
    where: {
      id,
      recipient_id: recipientId,
      deleted_at: null,
      read_at: null,
    },
    data: {
      read_at: new Date(),
    },
  });
}

function markAllRead(recipientId) {
  return prisma.notifications.updateMany({
    where: {
      recipient_id: recipientId,
      deleted_at: null,
      read_at: null,
    },
    data: {
      read_at: new Date(),
    },
  });
}

function findUsersByIds(ids) {
  const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)));
  if (uniqueIds.length === 0) return Promise.resolve([]);

  return prisma.users.findMany({
    where: {
      id: {
        in: uniqueIds,
      },
      is_active: true,
    },
    select: USER_SELECT,
  });
}

function findUsersWithMenuAction({ menuUrl, features = [] }) {
  return prisma.users.findMany({
    where: {
      is_active: true,
      role: {
        roles_menus: {
          some: {
            can_read: true,
            can_update: true,
            menu: {
              url: menuUrl,
            },
            ...(features.length > 0
              ? {
                  features: {
                    hasSome: features,
                  },
                }
              : {}),
          },
        },
      },
    },
    select: USER_SELECT,
  });
}

module.exports = {
  count,
  countUnread,
  create,
  findByDedupeKey,
  findByIdForRecipient,
  findMany,
  findUsersByIds,
  findUsersWithMenuAction,
  markAllRead,
  markRead,
  update,
};
