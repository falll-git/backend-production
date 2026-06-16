const repository = require("./outgoingMails.repository");
const prisma = require("../../config/prisma");
const notificationService = require("../notifications/notifications.service");
const {
  deleteReplacedStoredFile,
  deleteStoredFile,
  persistPersuratanFile,
} = require("../../utils/persuratan-files");
const { serializeOutgoingMail } = require("../../utils/persuratan-serializer");
const {
  normalizeDeliveryMedia,
  normalizeOutgoingStatus,
} = require("../../utils/persuratan-status");
const { mapPersuratanPrismaError } = require("../../utils/persuratan-errors");
const { AppError } = require("../../utils/errors");
const {
  buildOutgoingMailVisibilityWhere,
  canManageOutgoingMail,
  canViewOutgoingMail,
  getPersuratanAccessScope,
} = require("../../utils/persuratan-access");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  paginateArray,
  resolvePagination,
} = require("../../utils/pagination");
const {
  resolveActiveStorageId,
} = require("../../utils/persuratan-storage");
const {
  enqueueRecordWatermark,
} = require("../watermark-settings/watermarkProcessor.service");
const { toSizeBytesBigInt } = require("../../utils/size-bytes");

const OUTGOING_MAIL_MENU_URL =
  "/dashboard/manajemen-surat/kelola-surat/input-surat-keluar";

async function buildDeliveryMediaNameMap(codes) {
  const uniqueCodes = [...new Set((codes || []).filter(Boolean))];

  if (uniqueCodes.length === 0) {
    return new Map();
  }

  const rows = await prisma.mail_delivery_media.findMany({
    where: {
      code: {
        in: uniqueCodes,
      },
    },
    select: {
      code: true,
      name: true,
    },
  });

  return new Map(
    rows.map((row) => [String(row.code || ""), String(row.name || row.code || "")]),
  );
}

async function resolveActiveDeliveryMedia(value) {
  const deliveryMedia = normalizeDeliveryMedia(value);

  if (!deliveryMedia) {
    throw new AppError("Media pengiriman surat tidak valid.", 422);
  }

  const parameter = await prisma.mail_delivery_media.findFirst({
    where: {
      code: deliveryMedia,
      is_active: true,
      deleted_at: null,
    },
    select: {
      id: true,
    },
  });

  if (!parameter) {
    throw new AppError(
      "Media pengiriman surat tidak aktif atau belum terdaftar di Parameter.",
      422,
    );
  }

  return deliveryMedia;
}

async function queueOutgoingMailWatermark(entityId) {
  try {
    await enqueueRecordWatermark({
      module: "outgoing_mail",
      entityId,
    });
  } catch (error) {
    console.error("Failed to queue outgoing mail watermark:", error);
  }
}

function normalizeText(value) {
  if (typeof value !== "string") return value ?? null;

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeDate(value) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Format tanggal tidak valid.");
  }

  return date;
}

function normalizeOptionalDate(value) {
  if (!value) return null;
  return normalizeDate(value);
}

function appendAndFilter(where, clause) {
  where.AND = [...(where.AND || []), clause];
}

function buildWhere({
  search,
  dateFrom,
  dateTo,
  letterPrioritieId,
  deliveryMedia,
  divisionId,
}) {
  const where = {
    deleted_at: null,
  };

  if (search) {
    const deliveryMediaSearch = normalizeDeliveryMedia(search);
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { mail_number: { contains: search, mode: "insensitive" } },
      { address: { contains: search, mode: "insensitive" } },
      { follow_up_note: { contains: search, mode: "insensitive" } },
      { storage: { is: { name: { contains: search, mode: "insensitive" } } } },
      {
        storage: {
          is: {
            cabinet: {
              is: { code: { contains: search, mode: "insensitive" } },
            },
          },
        },
      },
      {
        storage: {
          is: {
            cabinet: {
              is: {
                office: {
                  is: { name: { contains: search, mode: "insensitive" } },
                },
              },
            },
          },
        },
      },
      ...(deliveryMediaSearch
        ? [{ delivery_media: deliveryMediaSearch }]
        : []),
    ];
  }

  if (letterPrioritieId) {
    where.letter_prioritie_id = letterPrioritieId;
  }

  if (deliveryMedia) {
    const normalizedDeliveryMedia = normalizeDeliveryMedia(deliveryMedia);
    if (normalizedDeliveryMedia) {
      where.delivery_media = normalizedDeliveryMedia;
    }
  }

  if (divisionId) {
    appendAndFilter(where, {
      creator: {
        division_id: divisionId,
      },
    });
  }

  const sendDateFilter = {};
  if (dateFrom) {
    sendDateFilter.gte = normalizeDate(dateFrom);
  }
  if (dateTo) {
    sendDateFilter.lte = normalizeDate(dateTo);
  }
  if (Object.keys(sendDateFilter).length > 0) {
    where.send_date = sendDateFilter;
  }

  return where;
}

async function serializeList(req, records) {
  const serialized = [];
  const deliveryMediaNames = await buildDeliveryMediaNameMap(
    records.map((record) => record.delivery_media),
  );

  for (const record of records) {
    const item = await serializeOutgoingMail({
      req,
      record,
      deliveryMediaNames,
    });

    serialized.push(item);
  }

  return serialized;
}

function filterByStatus(records, status) {
  if (status === undefined || status === null || status === "") {
    return records;
  }

  const normalized = String(status).trim().toUpperCase();

  return records.filter((item) => {
    if (normalized === "0" || normalized === "INACTIVE") {
      return item.status_key === "INACTIVE";
    }

    if (normalized === "1" || normalized === "ACTIVE") {
      return item.status_key === "ACTIVE";
    }

    return true;
  });
}

function hasSpecificStatusFilter(status) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();

  return Boolean(normalized && !["ALL", "SEMUA"].includes(normalized));
}

exports.getAll = async ({ req, query, userId, scopeOverride = null }) => {
  const scope =
    scopeOverride ||
    (await getPersuratanAccessScope(userId, OUTGOING_MAIL_MENU_URL));
  const where = {
    AND: [
      buildWhere({
        search: normalizeText(query.search),
        dateFrom: query.date_from,
        dateTo: query.date_to,
        letterPrioritieId: normalizeText(query.letter_prioritie_id),
        deliveryMedia: normalizeText(query.delivery_media),
        divisionId: normalizeText(query.division_id),
      }),
      buildOutgoingMailVisibilityWhere(scope),
    ],
  };

  const pagination = resolvePagination(query, {
    ...PAGINATION_PROFILES.TABLE,
    allowAll: true,
  });

  if (pagination.enabled && !hasSpecificStatusFilter(query.status)) {
    const records = await repository.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
    });
    const total = await repository.count(where);

    return {
      data: await serializeList(req, records),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  const records = await repository.findMany({ where });
  const serialized = await serializeList(req, records);
  const filtered = filterByStatus(serialized, query.status);

  return paginateArray(filtered, pagination);
};

exports.getById = async ({ req, id, userId }) => {
  const outgoingMail = await repository.findById(id);

  if (!outgoingMail) {
    throw new Error("Surat keluar tidak ditemukan.");
  }

  const scope = await getPersuratanAccessScope(userId, OUTGOING_MAIL_MENU_URL);
  if (!canViewOutgoingMail(outgoingMail, scope)) {
    throw new AppError("Surat keluar tidak ditemukan.", 404);
  }

  const deliveryMediaNames = await buildDeliveryMediaNameMap([
    outgoingMail.delivery_media,
  ]);

  return serializeOutgoingMail({
    req,
    record: outgoingMail,
    deliveryMediaNames,
  });
};

exports.create = async ({ req, payload, userId }) => {
  const storageId = await resolveActiveStorageId(payload.storage_id);
  const deliveryMedia = await resolveActiveDeliveryMedia(payload.delivery_media);
  const storedFile = persistPersuratanFile({
    entity: "outgoing-mails",
    input: payload.file,
    previousPath: null,
    fallbackBaseName: payload.mail_number || payload.name || "surat-keluar",
  });
  if (!storedFile.storedPath) {
    throw new Error("Dokumen surat keluar wajib diunggah.");
  }

  let created;

  try {
    created = await repository.create({
      letter_prioritie_id: payload.letter_prioritie_id,
      storage_id: storageId,
      delivery_media: deliveryMedia,
      name: normalizeText(payload.name),
      send_date: normalizeDate(payload.send_date),
      send_due_date: normalizeOptionalDate(payload.send_due_date),
      response_due_date: normalizeOptionalDate(payload.response_due_date),
      follow_up_note: normalizeText(payload.follow_up_note),
      address: normalizeText(payload.address),
      mail_number: normalizeText(payload.mail_number),
      file: storedFile.storedPath,
      file_name: storedFile.fileName,
      file_size_bytes: toSizeBytesBigInt(storedFile.sizeBytes),
      status: "ACTIVE",
      created_by: userId,
    });
  } catch (error) {
    if (storedFile.isNewUpload) {
      deleteStoredFile(storedFile.storedPath);
    }
    throw mapPersuratanPrismaError(error, "outgoing-mail");
  }

  if (created?.file) {
    await queueOutgoingMailWatermark(created.id);
    created = await repository.findById(created.id);
  }

  await notificationService.notifyOutgoingMailFollowUpCreated({
    outgoingMail: created,
    actorId: userId,
  });

  const deliveryMediaNames = await buildDeliveryMediaNameMap([
    created.delivery_media,
  ]);

  return serializeOutgoingMail({
    req,
    record: created,
    deliveryMediaNames,
  });
};

exports.update = async ({ req, id, payload, userId }) => {
  const outgoingMail = await repository.findById(id);

  if (!outgoingMail) {
    throw new Error("Surat keluar tidak ditemukan.");
  }

  const scope = await getPersuratanAccessScope(userId, OUTGOING_MAIL_MENU_URL);
  if (!canManageOutgoingMail(outgoingMail, scope)) {
    throw new AppError("Anda tidak memiliki akses untuk mengubah surat keluar ini.", 403);
  }

  const nextStorageId =
    payload.storage_id !== undefined
      ? await resolveActiveStorageId(payload.storage_id)
      : null;

  const storedFile = persistPersuratanFile({
    entity: "outgoing-mails",
    input: payload.file,
    previousPath: outgoingMail.file,
    fallbackBaseName:
      payload.mail_number ||
      payload.name ||
      outgoingMail.mail_number ||
      outgoingMail.name ||
      "surat-keluar",
  });

  const updateData = {
    updated_by: userId,
  };

  if (payload.letter_prioritie_id !== undefined) {
    updateData.letter_prioritie_id = payload.letter_prioritie_id;
  }
  if (payload.storage_id !== undefined) {
    updateData.storage_id = nextStorageId;
  }
  if (payload.delivery_media !== undefined) {
    updateData.delivery_media = await resolveActiveDeliveryMedia(
      payload.delivery_media,
    );
  }
  if (payload.name !== undefined) {
    updateData.name = normalizeText(payload.name);
  }
  if (payload.send_date !== undefined) {
    updateData.send_date = normalizeDate(payload.send_date);
  }
  if (payload.send_due_date !== undefined) {
    updateData.send_due_date = normalizeOptionalDate(payload.send_due_date);
  }
  if (payload.response_due_date !== undefined) {
    updateData.response_due_date = normalizeOptionalDate(payload.response_due_date);
  }
  if (payload.follow_up_note !== undefined) {
    updateData.follow_up_note = normalizeText(payload.follow_up_note);
  }
  if (payload.address !== undefined) {
    updateData.address = normalizeText(payload.address);
  }
  if (payload.mail_number !== undefined) {
    updateData.mail_number = normalizeText(payload.mail_number);
  }
  if (payload.file !== undefined) {
    updateData.file = storedFile.storedPath;
    updateData.file_name = storedFile.fileName;
    updateData.file_size_bytes = toSizeBytesBigInt(
      storedFile.sizeBytes ?? outgoingMail.file_size_bytes ?? null,
    );
  }
  if (payload.status !== undefined) {
    updateData.status = normalizeOutgoingStatus(payload.status);
  }

  let updated;

  try {
    updated = await repository.update(id, updateData);
  } catch (error) {
    if (storedFile.isNewUpload) {
      deleteStoredFile(storedFile.storedPath);
    }
    throw mapPersuratanPrismaError(error, "outgoing-mail");
  }

  if (payload.file !== undefined) {
    deleteReplacedStoredFile(outgoingMail.file, updated.file);
  }

  if (storedFile.isNewUpload && updated?.file) {
    await queueOutgoingMailWatermark(updated.id);
    updated = await repository.findById(updated.id);
  }

  const deliveryMediaNames = await buildDeliveryMediaNameMap([
    updated.delivery_media,
  ]);

  return serializeOutgoingMail({
    req,
    record: updated,
    deliveryMediaNames,
  });
};

exports.delete = async (id, userId) => {
  const outgoingMail = await repository.findById(id);

  if (!outgoingMail) {
    throw new Error("Surat keluar tidak ditemukan.");
  }

  const scope = await getPersuratanAccessScope(userId, OUTGOING_MAIL_MENU_URL);
  if (!canManageOutgoingMail(outgoingMail, scope)) {
    throw new AppError("Anda tidak memiliki akses untuk menghapus surat keluar ini.", 403);
  }

  const deleted = await repository.delete(id, userId);
  deleteStoredFile(outgoingMail.file);

  return deleted;
};
