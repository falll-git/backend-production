const prisma = require("../../config/prisma");
const repository = require("./notifications.repository");
const { sendMail } = require("../../utils/mailer");
const { buildNotificationEmailTemplate } = require("../../utils/mail-templates");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const {
  APPROVE_FEATURE,
  HANDOVER_FEATURE,
  REJECT_FEATURE,
  RETURN_FEATURE,
} = require("../../utils/menu-access");

const EMAIL_EVENT_TYPES = new Set([
  "ACTION_REQUIRED",
  "APPROVED",
  "REJECTED",
  "DUE_SOON",
  "OVERDUE",
]);

const ARCHIVE_ACCESS_MENU_URL = "/dashboard/arsip-digital/disposisi/permintaan";
const ARCHIVE_LOAN_MENU_URL = "/dashboard/arsip-digital/peminjaman/accept";

function normalizeText(value, fallback = "") {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, " ");

  return text || fallback;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateLabel(value) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function buildFrontendLink(linkUrl) {
  const frontendUrl = String(process.env.FRONTEND_URL || "").trim().replace(/\/$/, "");
  if (!linkUrl) return frontendUrl || null;
  if (/^https?:\/\//i.test(linkUrl)) return linkUrl;
  return frontendUrl ? `${frontendUrl}${linkUrl}` : linkUrl;
}

function serializeNotification(item) {
  return {
    id: item.id,
    module: item.module,
    event_type: item.event_type,
    entity_type: item.entity_type,
    entity_id: item.entity_id,
    title: item.title,
    message: item.message,
    link_url: item.link_url,
    priority: item.priority,
    read_at: item.read_at,
    is_read: Boolean(item.read_at),
    email_status: item.email_status,
    email_sent_at: item.email_sent_at,
    created_by: item.created_by,
    created_at: item.created_at,
  };
}

function shouldSendEmail(payload) {
  if (payload.email === false) return false;
  return EMAIL_EVENT_TYPES.has(payload.event_type);
}

function isDedupeConflict(error, payload) {
  return Boolean(payload?.dedupe_key && error?.code === "P2002");
}

async function sendNotificationEmail(notification) {
  const recipient = notification.recipient;
  if (!recipient?.email) {
    await repository.update(notification.id, {
      email_status: "SKIPPED",
      email_error: "RECIPIENT_EMAIL_EMPTY",
    });
    return;
  }

  const actionLink = buildFrontendLink(notification.link_url);
  const template = buildNotificationEmailTemplate({
    name: recipient.name || recipient.username,
    title: notification.title,
    message: notification.message,
    actionUrl: actionLink,
  });

  try {
    const result = await sendMail({
      to: recipient.email,
      subject: template.subject,
      text: template.text,
      html: template.html,
    });

    await repository.update(notification.id, {
      email_status: result.sent ? "SENT" : String(result.status || "SKIPPED").toUpperCase(),
      email_sent_at: result.sent ? new Date() : null,
      email_error: result.sent ? null : result.reason || null,
    });
  } catch (error) {
    await repository.update(notification.id, {
      email_status: "FAILED",
      email_error: String(error.message || "Email gagal dikirim.").slice(0, 500),
    }).catch(() => {});
    console.error("Failed to send notification email:", error);
  }
}

async function createNotification(payload) {
  if (!payload.recipient_id) return null;

  if (payload.dedupe_key) {
    const existing = await repository.findByDedupeKey(payload.dedupe_key);
    if (existing) return existing;
  }

  let notification;

  try {
    notification = await repository.create({
      recipient_id: payload.recipient_id,
      module: normalizeText(payload.module, "SYSTEM"),
      event_type: normalizeText(payload.event_type, "INFO"),
      entity_type: normalizeText(payload.entity_type, "GENERAL"),
      entity_id: normalizeText(payload.entity_id, "GENERAL"),
      title: normalizeText(payload.title, "Notifikasi"),
      message: normalizeText(payload.message),
      link_url: payload.link_url || null,
      priority: normalizeText(payload.priority, "NORMAL"),
      email_status: shouldSendEmail(payload) ? "PENDING" : "SKIPPED",
      dedupe_key: payload.dedupe_key || null,
      created_by: payload.created_by || null,
    });
  } catch (error) {
    if (isDedupeConflict(error, payload)) {
      const existing = await repository.findByDedupeKey(payload.dedupe_key);
      if (existing) return existing;
    }

    throw error;
  }

  if (shouldSendEmail(payload)) {
    await sendNotificationEmail(notification);
  }

  return notification;
}

async function safeCreateNotification(payload) {
  try {
    return await createNotification(payload);
  } catch (error) {
    console.error("Failed to create notification:", error);
    return null;
  }
}

async function safeCreateNotifications(recipients, payload) {
  const users = await repository.findUsersByIds(recipients);
  const created = [];

  for (const user of users) {
    const notification = await safeCreateNotification({
      ...payload,
      recipient_id: user.id,
      dedupe_key: payload.dedupe_key
        ? `${payload.dedupe_key}:recipient:${user.id}`
        : null,
    });
    if (notification) created.push(notification);
  }

  return created;
}

function documentLabel(document) {
  return normalizeText(
    document?.document_name || document?.document_number,
    "Dokumen arsip",
  );
}

function mailLabel(record) {
  return normalizeText(
    record?.regarding || record?.name || record?.memo_number || record?.mail_number,
    "Dokumen persuratan",
  );
}

async function getArchiveActionUsers(menuUrl, features) {
  return repository.findUsersWithMenuAction({
    menuUrl,
    features,
  });
}

exports.notifyArchiveAccessRequested = async ({ item, actorId }) => {
  const document = item.document;
  return safeCreateNotification({
    recipient_id: item.owner_id,
    module: "DIGITAL_ARCHIVE",
    event_type: "ACTION_REQUIRED",
    entity_type: "DIGITAL_DOCUMENT_ACCESS_REQUEST",
    entity_id: item.id,
    title: "Pengajuan disposisi menunggu persetujuan",
    message: `Pengajuan akses untuk ${documentLabel(document)} perlu ditinjau.`,
    link_url: "/dashboard/arsip-digital/disposisi/permintaan",
    priority: "HIGH",
    dedupe_key: `digital_archive:access_requested:${item.id}`,
    created_by: actorId,
  });
};

exports.notifyArchiveAccessResolved = async ({ item, actorId, approved }) => {
  return safeCreateNotification({
    recipient_id: item.requester_id,
    module: "DIGITAL_ARCHIVE",
    event_type: approved ? "APPROVED" : "REJECTED",
    entity_type: "DIGITAL_DOCUMENT_ACCESS_REQUEST",
    entity_id: item.id,
    title: approved ? "Disposisi arsip disetujui" : "Disposisi arsip ditolak",
    message: approved
      ? `Akses sementara untuk ${documentLabel(item.document)} telah disetujui sampai ${dateLabel(item.expires_at)}.`
      : `Pengajuan akses untuk ${documentLabel(item.document)} ditolak.`,
    link_url: "/dashboard/arsip-digital/disposisi/historis",
    priority: approved ? "NORMAL" : "HIGH",
    dedupe_key: `digital_archive:access_${approved ? "approved" : "rejected"}:${item.id}`,
    created_by: actorId,
  });
};

exports.notifyArchiveLoanRequested = async ({ item, actorId }) => {
  const actionUsers = await getArchiveActionUsers(ARCHIVE_LOAN_MENU_URL, [
    APPROVE_FEATURE,
    REJECT_FEATURE,
  ]);
  const fallbackRecipients = [
    item.document?.owner_user_id,
    item.document?.created_by,
  ].filter((id) => id && id !== item.borrower_id);
  const recipients = actionUsers.length > 0
    ? actionUsers.map((user) => user.id).filter((id) => id !== item.borrower_id)
    : fallbackRecipients;

  return safeCreateNotifications(recipients, {
    module: "DIGITAL_ARCHIVE",
    event_type: "ACTION_REQUIRED",
    entity_type: "DIGITAL_DOCUMENT_LOAN",
    entity_id: item.id,
    title: "Pengajuan peminjaman arsip menunggu tindakan",
    message: `Pengajuan peminjaman ${documentLabel(item.document)} perlu ditinjau.`,
    link_url: "/dashboard/arsip-digital/peminjaman/accept",
    priority: "HIGH",
    dedupe_key: `digital_archive:loan_requested:${item.id}`,
    created_by: actorId,
  });
};

exports.notifyArchiveLoanResolved = async ({ item, actorId, status }) => {
  const isApproved = status === "APPROVED";
  const isRejected = status === "REJECTED";
  const isHandover = status === "HANDED_OVER";

  return safeCreateNotification({
    recipient_id: item.borrower_id,
    module: "DIGITAL_ARCHIVE",
    event_type: isRejected ? "REJECTED" : isApproved ? "APPROVED" : "ACTION_REQUIRED",
    entity_type: "DIGITAL_DOCUMENT_LOAN",
    entity_id: item.id,
    title: isRejected
      ? "Peminjaman arsip ditolak"
      : isHandover
        ? "Dokumen arsip siap digunakan"
        : "Peminjaman arsip disetujui",
    message: isRejected
      ? `Pengajuan peminjaman ${documentLabel(item.document)} ditolak.`
      : isHandover
        ? `${documentLabel(item.document)} telah diserahkan kepada peminjam.`
        : `Pengajuan peminjaman ${documentLabel(item.document)} telah disetujui.`,
    link_url: "/dashboard/arsip-digital/historis/peminjaman",
    priority: isRejected ? "HIGH" : "NORMAL",
    dedupe_key: `digital_archive:loan_${status.toLowerCase()}:${item.id}`,
    created_by: actorId,
  });
};

exports.notifyIncomingMailDispositions = async ({ incomingMail, dispositions, actorId, redisposition = false }) => {
  const items = (dispositions || []).filter((item) => item?.receiver_id);
  const results = [];

  for (const item of items) {
    results.push(
      await safeCreateNotification({
        recipient_id: item.receiver_id,
        module: "CORRESPONDENCE",
        event_type: "ACTION_REQUIRED",
        entity_type: "INCOMING_MAIL_DISPOSITION",
        entity_id: item.id || incomingMail.id,
        title: redisposition ? "Redisposisi surat masuk baru" : "Disposisi surat masuk baru",
        message: `${mailLabel(incomingMail)} membutuhkan tindak lanjut Anda.`,
        link_url: `/dashboard/manajemen-surat/laporan?kind=surat-masuk&id=${incomingMail.id}`,
        priority: "HIGH",
        dedupe_key: `correspondence:incoming_${redisposition ? "redisposition" : "disposition"}:${item.id || incomingMail.id}:recipient:${item.receiver_id}`,
        created_by: actorId,
      }),
    );
  }

  return results;
};

exports.notifyMemorandumDispositions = async ({ memorandum, dispositions, actorId, redisposition = false }) => {
  const items = (dispositions || []).filter((item) => item?.receiver_id);
  const results = [];

  for (const item of items) {
    results.push(
      await safeCreateNotification({
        recipient_id: item.receiver_id,
        module: "CORRESPONDENCE",
        event_type: "ACTION_REQUIRED",
        entity_type: "MEMORANDUM_DISPOSITION",
        entity_id: item.id || memorandum.id,
        title: redisposition ? "Redisposisi memorandum baru" : "Disposisi memorandum baru",
        message: `${mailLabel(memorandum)} membutuhkan tindak lanjut Anda.`,
        link_url: `/dashboard/manajemen-surat/laporan?kind=memorandum&id=${memorandum.id}`,
        priority: "HIGH",
        dedupe_key: `correspondence:memo_${redisposition ? "redisposition" : "disposition"}:${item.id || memorandum.id}:recipient:${item.receiver_id}`,
        created_by: actorId,
      }),
    );
  }

  return results;
};

exports.notifyOutgoingMailFollowUpCreated = async ({ outgoingMail, actorId }) => {
  if (!outgoingMail.created_by || (!outgoingMail.send_due_date && !outgoingMail.response_due_date)) {
    return null;
  }

  return safeCreateNotification({
    recipient_id: outgoingMail.created_by,
    module: "CORRESPONDENCE",
    event_type: "INFO",
    entity_type: "OUTGOING_MAIL",
    entity_id: outgoingMail.id,
    title: "Pengingat surat keluar tercatat",
    message: `${mailLabel(outgoingMail)} memiliki tenggat follow-up yang akan dipantau.`,
    link_url: `/dashboard/manajemen-surat/laporan?kind=surat-keluar&id=${outgoingMail.id}`,
    priority: "NORMAL",
    dedupe_key: `correspondence:outgoing_followup_created:${outgoingMail.id}`,
    created_by: actorId,
    email: false,
  });
};

async function createDueNotification({ userId, module, entityType, entityId, title, message, linkUrl, overdue, dedupeKey }) {
  return safeCreateNotification({
    recipient_id: userId,
    module,
    event_type: overdue ? "OVERDUE" : "DUE_SOON",
    entity_type: entityType,
    entity_id: entityId,
    title,
    message,
    link_url: linkUrl,
    priority: overdue ? "CRITICAL" : "HIGH",
    dedupe_key: dedupeKey,
    created_by: null,
  });
}

async function generateArchiveAccessReminders(userId, now, nextThreeDays) {
  const requests = await prisma.digital_document_access_requests.findMany({
    where: {
      requester_id: userId,
      status: "APPROVED",
      expires_at: {
        lte: nextThreeDays,
      },
    },
    include: {
      document: true,
    },
    take: 50,
  });

  for (const item of requests) {
    const overdue = item.expires_at < now;
    await createDueNotification({
      userId,
      module: "DIGITAL_ARCHIVE",
      entityType: "DIGITAL_DOCUMENT_ACCESS_REQUEST",
      entityId: item.id,
      title: overdue ? "Akses disposisi arsip sudah kedaluwarsa" : "Akses disposisi arsip hampir berakhir",
      message: overdue
        ? `Akses sementara untuk ${documentLabel(item.document)} sudah melewati ${dateLabel(item.expires_at)}.`
        : `Akses sementara untuk ${documentLabel(item.document)} akan berakhir pada ${dateLabel(item.expires_at)}.`,
      linkUrl: "/dashboard/arsip-digital/disposisi/historis",
      overdue,
      dedupeKey: `digital_archive:access_${overdue ? "expired" : "due_soon"}:${item.id}:recipient:${userId}`,
    });
  }
}

async function generateArchiveLoanReminders(userId, now, nextThreeDays) {
  const loans = await prisma.digital_document_loans.findMany({
    where: {
      status: {
        in: ["HANDED_OVER", "BORROWED"],
      },
      requested_due_date: {
        lte: nextThreeDays,
      },
      OR: [
        { borrower_id: userId },
        { approved_by: userId },
        { handed_over_by: userId },
      ],
    },
    include: {
      document: true,
    },
    take: 50,
  });

  for (const item of loans) {
    const overdue = item.requested_due_date < now;
    await createDueNotification({
      userId,
      module: "DIGITAL_ARCHIVE",
      entityType: "DIGITAL_DOCUMENT_LOAN",
      entityId: item.id,
      title: overdue ? "Peminjaman arsip melewati jatuh tempo" : "Peminjaman arsip mendekati jatuh tempo",
      message: overdue
        ? `${documentLabel(item.document)} melewati jatuh tempo pengembalian ${dateLabel(item.requested_due_date)}.`
        : `${documentLabel(item.document)} perlu dikembalikan paling lambat ${dateLabel(item.requested_due_date)}.`,
      linkUrl: "/dashboard/arsip-digital/ruang-arsip/jatuh-tempo",
      overdue,
      dedupeKey: `digital_archive:loan_${overdue ? "overdue" : "due_soon"}:${item.id}:recipient:${userId}`,
    });
  }
}

async function generateIncomingMailReminders(userId, now, nextThreeDays) {
  const dispositions = await prisma.incoming_mail_dispositions.findMany({
    where: {
      receiver_id: userId,
      status: {
        in: ["NEW", "IN_PROGRESS"],
      },
      due_date: {
        lte: nextThreeDays,
      },
      incoming_mail: {
        deleted_at: null,
      },
    },
    include: {
      incoming_mail: true,
    },
    take: 50,
  });

  for (const item of dispositions) {
    const overdue = item.due_date < now;
    await createDueNotification({
      userId,
      module: "CORRESPONDENCE",
      entityType: "INCOMING_MAIL_DISPOSITION",
      entityId: item.id,
      title: overdue ? "Disposisi surat masuk melewati tenggat" : "Disposisi surat masuk mendekati tenggat",
      message: overdue
        ? `${mailLabel(item.incoming_mail)} melewati tenggat ${dateLabel(item.due_date)}.`
        : `${mailLabel(item.incoming_mail)} perlu ditindaklanjuti paling lambat ${dateLabel(item.due_date)}.`,
      linkUrl: `/dashboard/manajemen-surat/laporan?kind=surat-masuk&id=${item.incoming_mails_id}`,
      overdue,
      dedupeKey: `correspondence:incoming_${overdue ? "overdue" : "due_soon"}:${item.id}:recipient:${userId}`,
    });
  }
}

async function generateMemorandumReminders(userId, now, nextThreeDays) {
  const dispositions = await prisma.memorandum_dispositions.findMany({
    where: {
      receiver_id: userId,
      status: {
        in: ["NEW", "IN_PROGRESS"],
      },
      due_date: {
        lte: nextThreeDays,
      },
      memorandum: {
        deleted_at: null,
      },
    },
    include: {
      memorandum: true,
    },
    take: 50,
  });

  for (const item of dispositions) {
    const overdue = item.due_date < now;
    await createDueNotification({
      userId,
      module: "CORRESPONDENCE",
      entityType: "MEMORANDUM_DISPOSITION",
      entityId: item.id,
      title: overdue ? "Disposisi memorandum melewati tenggat" : "Disposisi memorandum mendekati tenggat",
      message: overdue
        ? `${mailLabel(item.memorandum)} melewati tenggat ${dateLabel(item.due_date)}.`
        : `${mailLabel(item.memorandum)} perlu ditindaklanjuti paling lambat ${dateLabel(item.due_date)}.`,
      linkUrl: `/dashboard/manajemen-surat/laporan?kind=memorandum&id=${item.memorandums_id}`,
      overdue,
      dedupeKey: `correspondence:memo_${overdue ? "overdue" : "due_soon"}:${item.id}:recipient:${userId}`,
    });
  }
}

async function generateOutgoingMailReminders(userId, now, nextThreeDays) {
  const mails = await prisma.outgoing_mails.findMany({
    where: {
      created_by: userId,
      deleted_at: null,
      status: "ACTIVE",
      OR: [
        { send_due_date: { lte: nextThreeDays } },
        { response_due_date: { lte: nextThreeDays } },
      ],
    },
    take: 50,
  });

  for (const item of mails) {
    const reminders = [
      { key: "send", value: item.send_due_date, label: "pengiriman" },
      { key: "response", value: item.response_due_date, label: "balasan/follow-up" },
    ].filter((entry) => entry.value);

    for (const reminder of reminders) {
      if (reminder.value > nextThreeDays) continue;
      const overdue = reminder.value < now;
      await createDueNotification({
        userId,
        module: "CORRESPONDENCE",
        entityType: "OUTGOING_MAIL",
        entityId: item.id,
        title: overdue ? "Surat keluar melewati tenggat" : "Surat keluar mendekati tenggat",
        message: overdue
          ? `${mailLabel(item)} melewati tenggat ${reminder.label} ${dateLabel(reminder.value)}.`
          : `${mailLabel(item)} memiliki tenggat ${reminder.label} pada ${dateLabel(reminder.value)}.`,
        linkUrl: `/dashboard/manajemen-surat/laporan?kind=surat-keluar&id=${item.id}`,
        overdue,
        dedupeKey: `correspondence:outgoing_${reminder.key}_${overdue ? "overdue" : "due_soon"}:${item.id}:recipient:${userId}`,
      });
    }
  }
}

async function generateDueNotifications(userId) {
  if (!userId) return;

  const now = new Date();
  const nextThreeDays = addDays(now, 3);

  await generateArchiveAccessReminders(userId, now, nextThreeDays);
  await generateArchiveLoanReminders(userId, now, nextThreeDays);
  await generateIncomingMailReminders(userId, now, nextThreeDays);
  await generateMemorandumReminders(userId, now, nextThreeDays);
  await generateOutgoingMailReminders(userId, now, nextThreeDays);
}

exports.getAll = async ({ query, userId }) => {
  await generateDueNotifications(userId);

  const pagination = resolvePagination(query, {
    ...PAGINATION_PROFILES.TABLE,
    defaultLimit: Math.min(Number(query.limit) || 10, 50),
    maxLimit: 50,
  });
  const where = {
    recipient_id: userId,
    deleted_at: null,
    ...(query.unread_only ? { read_at: null } : {}),
    ...(query.module ? { module: String(query.module).trim().toUpperCase() } : {}),
  };
  const [data, total] = await Promise.all([
    repository.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
    }),
    repository.count(where),
  ]);

  return {
    data: data.map(serializeNotification),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getUnreadCount = async ({ userId }) => {
  await generateDueNotifications(userId);

  return {
    unread_count: await repository.countUnread(userId),
  };
};

exports.markRead = async ({ id, userId }) => {
  await repository.markRead(id, userId);
  const notification = await repository.findByIdForRecipient(id, userId);
  return notification ? serializeNotification(notification) : null;
};

exports.markAllRead = async ({ userId }) => {
  const result = await repository.markAllRead(userId);
  return {
    updated_count: result.count || 0,
  };
};
