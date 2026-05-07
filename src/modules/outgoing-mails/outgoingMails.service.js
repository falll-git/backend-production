const repository = require("./outgoingMails.repository");
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

function parsePagination({ page, limit }) {
  if (!page && !limit) {
    return { enabled: false, page: 1, limit: 0 };
  }

  return {
    enabled: true,
    page: Math.max(Number(page) || 1, 1),
    limit: Math.max(Number(limit) || 10, 1),
  };
}

function paginateData(data, pagination) {
  if (!pagination.enabled) {
    return { data, meta: null };
  }

  const startIndex = (pagination.page - 1) * pagination.limit;
  const paginatedData = data.slice(startIndex, startIndex + pagination.limit);

  return {
    data: paginatedData,
    meta: {
      total: data.length,
      page: pagination.page,
      lastPage: Math.ceil(data.length / pagination.limit) || 1,
    },
  };
}

function buildWhere({
  search,
  dateFrom,
  dateTo,
  letterPrioritieId,
  deliveryMedia,
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

  for (const record of records) {
    const item = await serializeOutgoingMail({
      req,
      record,
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

exports.getAll = async ({ req, query }) => {
  const where = buildWhere({
    search: normalizeText(query.search),
    dateFrom: query.date_from,
    dateTo: query.date_to,
    letterPrioritieId: normalizeText(query.letter_prioritie_id),
    deliveryMedia: normalizeText(query.delivery_media),
  });

  const records = await repository.findMany({ where });
  const serialized = await serializeList(req, records);
  const filtered = filterByStatus(serialized, query.status);

  return paginateData(
    filtered,
    parsePagination({ page: query.page, limit: query.limit }),
  );
};

exports.getById = async ({ req, id }) => {
  const outgoingMail = await repository.findById(id);

  if (!outgoingMail) {
    throw new Error("Surat keluar tidak ditemukan.");
  }

  return serializeOutgoingMail({
    req,
    record: outgoingMail,
  });
};

exports.create = async ({ req, payload, userId }) => {
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
      delivery_media: normalizeDeliveryMedia(payload.delivery_media),
      name: normalizeText(payload.name),
      send_date: normalizeDate(payload.send_date),
      address: normalizeText(payload.address),
      mail_number: normalizeText(payload.mail_number),
      file: storedFile.storedPath,
      status: "ACTIVE",
      created_by: userId,
    });
  } catch (error) {
    if (storedFile.isNewUpload) {
      deleteStoredFile(storedFile.storedPath);
    }
    throw mapPersuratanPrismaError(error, "outgoing-mail");
  }

  return serializeOutgoingMail({
    req,
    record: created,
  });
};

exports.update = async ({ req, id, payload, userId }) => {
  const outgoingMail = await repository.findById(id);

  if (!outgoingMail) {
    throw new Error("Surat keluar tidak ditemukan.");
  }

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
  if (payload.delivery_media !== undefined) {
    updateData.delivery_media = normalizeDeliveryMedia(payload.delivery_media);
  }
  if (payload.name !== undefined) {
    updateData.name = normalizeText(payload.name);
  }
  if (payload.send_date !== undefined) {
    updateData.send_date = normalizeDate(payload.send_date);
  }
  if (payload.address !== undefined) {
    updateData.address = normalizeText(payload.address);
  }
  if (payload.mail_number !== undefined) {
    updateData.mail_number = normalizeText(payload.mail_number);
  }
  if (payload.file !== undefined) {
    updateData.file = storedFile.storedPath;
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

  return serializeOutgoingMail({
    req,
    record: updated,
  });
};

exports.delete = async (id, userId) => {
  const outgoingMail = await repository.findById(id);

  if (!outgoingMail) {
    throw new Error("Surat keluar tidak ditemukan.");
  }

  const deleted = await repository.delete(id, userId);
  deleteStoredFile(outgoingMail.file);

  return deleted;
};
