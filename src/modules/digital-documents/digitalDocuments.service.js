const repository = require("./digitalDocuments.repository");
const { AppError } = require("../../utils/errors");
const {
  getDigitalArchiveAccessScope,
  buildDocumentVisibilityWhere,
} = require("../../utils/digital-archive-access");
const {
  persistDigitalArchiveFile,
} = require("../../utils/digital-archive-files");
const {
  serializeDigitalDocumentDetail,
  serializeDigitalDocumentSummary,
  serializeDigitalDocumentActivityLog,
} = require("../../utils/digital-archive-serializer");

function normalizeText(value) {
  if (value === undefined || value === null) return null;

  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized || null;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDocumentName(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new AppError("Nama dokumen wajib diisi", 422);
  }

  return normalized;
}

function buildDocumentFilePayload({
  documentId,
  storedFile,
  originalInput,
  uploadedBy,
}) {
  if (!storedFile?.storedPath) return null;

  const sizeBytes =
    originalInput &&
    typeof originalInput === "object" &&
    Buffer.isBuffer(originalInput.buffer)
      ? originalInput.buffer.length
      : null;

  return {
    document_id: documentId,
    file_path: storedFile.storedPath,
    file_name: storedFile.fileName || null,
    mime_type: storedFile.mimeType || null,
    size_bytes: sizeBytes,
    is_primary: true,
    uploaded_by: uploadedBy,
  };
}

function buildSearchWhere(search) {
  const normalized = normalizeText(search);
  if (!normalized) return {};

  return {
    OR: [
      {
        document_number: {
          contains: normalized,
          mode: "insensitive",
        },
      },
      {
        document_name: {
          contains: normalized,
          mode: "insensitive",
        },
      },
      {
        description: {
          contains: normalized,
          mode: "insensitive",
        },
      },
      {
        document_type: {
          code: {
            contains: normalized,
            mode: "insensitive",
          },
        },
      },
      {
        document_type: {
          name: {
            contains: normalized,
            mode: "insensitive",
          },
        },
      },
      {
        storage: {
          name: {
            contains: normalized,
            mode: "insensitive",
          },
        },
      },
      {
        storage: {
          cabinet: {
            code: {
              contains: normalized,
              mode: "insensitive",
            },
          },
        },
      },
      {
        storage: {
          cabinet: {
            office: {
              name: {
                contains: normalized,
                mode: "insensitive",
              },
            },
          },
        },
      },
      {
        storage: {
          cabinet: {
            office: {
              code: {
                contains: normalized,
                mode: "insensitive",
              },
            },
          },
        },
      },
    ],
  };
}

function buildAvailabilityWhere(availability) {
  switch (
    String(availability || "")
      .trim()
      .toUpperCase()
  ) {
    case "AVAILABLE":
      return {
        loans: {
          none: {
            status: {
              in: repository.ACTIVE_LOAN_STATUSES,
            },
          },
        },
      };
    case "REQUESTED":
      return {
        loans: {
          some: {
            status: "PENDING",
          },
        },
      };
    case "PROCESSING":
      return {
        loans: {
          some: {
            status: "APPROVED",
          },
        },
      };
    case "BORROWED":
      return {
        loans: {
          some: {
            status: "BORROWED",
          },
        },
      };
    default:
      return {};
  }
}

function buildDocumentWhere(query, scope) {
  const visibilityWhere = buildDocumentVisibilityWhere(scope);
  const searchWhere = buildSearchWhere(query.search);
  const availabilityWhere = buildAvailabilityWhere(query.availability);

  const where = {
    deleted_at: null,
    ...visibilityWhere,
    ...searchWhere,
    ...availabilityWhere,
  };

  if (query.document_type_id) {
    where.document_type_id = query.document_type_id;
  }

  if (query.storage_id) {
    where.storage_id = query.storage_id;
  }

  if (query.office_id) {
    where.storage = {
      ...(where.storage || {}),
      cabinet: {
        ...((where.storage && where.storage.cabinet) || {}),
        office_id: query.office_id,
      },
    };
  }

  if (query.cabinet_id) {
    where.storage = {
      ...(where.storage || {}),
      cabinet_id: query.cabinet_id,
    };
  }

  if (query.is_restricted !== undefined) {
    const normalized = String(query.is_restricted).trim().toLowerCase();
    if (normalized === "true" || normalized === "false") {
      where.is_restricted = normalized === "true";
    }
  }

  return where;
}

function buildDocumentNumberPrefix(documentType) {
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const typeCode = String(documentType.code).trim().toUpperCase();
  return `${typeCode}-${period}`;
}

async function generateDocumentNumber(documentType, client, offset = 0) {
  const prefix = buildDocumentNumberPrefix(documentType);
  const total = await repository.countByDocumentNumberPrefix(prefix, client);
  const nextSequence = total + 1 + offset;
  return `${prefix}-${String(nextSequence).padStart(4, "0")}`;
}

function isPrismaUniqueError(error) {
  return error && error.code === "P2002";
}

async function createDocumentWithGeneratedNumber({
  client,
  payload,
  storage,
  documentType,
  userId,
}) {
  const normalizedName = normalizeDocumentName(payload.document_name);
  const description = normalizeText(payload.description);
  const storedFile = persistDigitalArchiveFile({
    entity: "documents",
    input: payload.file,
    fallbackBaseName: normalizedName,
  });

  for (let offset = 0; offset < 10; offset += 1) {
    const documentNumber = await generateDocumentNumber(
      documentType,
      client,
      offset,
    );

    try {
      const created = await repository.create(
        {
          storage_id: storage.id,
          document_type_id: documentType.id,
          document_number: documentNumber,
          document_name: normalizedName,
          description,
          file: storedFile.storedPath,
          is_restricted: Boolean(payload.is_restricted),
          access_level: payload.is_restricted ? "RESTRICT" : "NON_RESTRICT",
          created_by: userId,
        },
        client,
      );

      const documentFilePayload = buildDocumentFilePayload({
        documentId: created.id,
        storedFile,
        originalInput: payload.file,
        uploadedBy: userId,
      });

      if (documentFilePayload) {
        await repository.createDocumentFile(documentFilePayload, client);
      }

      return created;
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new AppError("Gagal membuat nomor dokumen otomatis", 500);
}

async function ensureSupportingData({ storageId, documentTypeId }, client) {
  const storage = await repository.findStorageById(storageId, client);
  if (!storage) {
    throw new AppError("Tempat penyimpanan tidak ditemukan", 404);
  }

  const documentType = await repository.findDocumentTypeById(
    documentTypeId,
    client,
  );
  if (!documentType) {
    throw new AppError("Jenis dokumen tidak ditemukan", 404);
  }

  return {
    storage,
    documentType,
  };
}

function buildUpdateLogMessages({
  hasMetadataChange,
  storageChanged,
  fileChanged,
}) {
  const logs = [];

  if (storageChanged) {
    logs.push({
      action: "STORAGE_MOVED",
      description: "Lokasi penyimpanan dokumen dipindahkan",
    });
  }

  if (hasMetadataChange || fileChanged) {
    logs.push({
      action: "UPDATED",
      description: fileChanged
        ? "Metadata dan file dokumen diperbarui"
        : "Metadata dokumen diperbarui",
    });
  }

  return logs;
}

async function hydrateDocumentMetrics(document) {
  if (!document) return null;

  const pendingAccessRequestCount =
    await repository.countPendingAccessRequestsByDocumentId(document.id);
  const totalLoanCount = await repository.countLoansByDocumentId(document.id);

  return {
    ...document,
    access_requests_pending_count: pendingAccessRequestCount,
    loan_count: totalLoanCount,
  };
}

exports.getAll = async ({ req, query, userId }) => {
  const scope = await getDigitalArchiveAccessScope(userId);
  const where = buildDocumentWhere(query, scope);

  if (String(query.limit || "").toLowerCase() === "all") {
    const data = await repository.findMany({ where });
    return {
      data: data.map((item) => serializeDigitalDocumentSummary(req, item)),
    };
  }

  const page = parsePositiveInteger(query.page, 1);
  const limit = Math.min(parsePositiveInteger(query.limit, 20), 100);
  const skip = (page - 1) * limit;

  const data = await repository.findMany({
    where,
    skip,
    take: limit,
  });
  const total = await repository.count(where);

  return {
    data: data.map((item) => serializeDigitalDocumentSummary(req, item)),
    meta: {
      total,
      page,
      lastPage: Math.ceil(total / limit),
    },
  };
};

exports.getById = async ({ req, id, userId }) => {
  const scope = await getDigitalArchiveAccessScope(userId);
  const visibilityWhere = buildDocumentVisibilityWhere(scope);

  const document = await repository.findById(id, {
    deleted_at: null,
    ...visibilityWhere,
  });

  if (!document) {
    throw new AppError("Dokumen tidak ditemukan", 404);
  }

  return serializeDigitalDocumentDetail(
    req,
    await hydrateDocumentMetrics(document),
  );
};

exports.getActivityLogs = async ({ id, query, userId }) => {
  const scope = await getDigitalArchiveAccessScope(userId);
  const visibilityWhere = buildDocumentVisibilityWhere(scope);
  const document = await repository.findById(id, {
    deleted_at: null,
    ...visibilityWhere,
  });

  if (!document) {
    throw new AppError("Dokumen tidak ditemukan", 404);
  }

  const page = parsePositiveInteger(query.page, 1);
  const limit = Math.min(parsePositiveInteger(query.limit, 20), 100);
  const skip = (page - 1) * limit;

  const data = await repository.findActivityLogsByDocumentId(id, {
    skip,
    take: limit,
  });
  const total = await repository.countActivityLogsByDocumentId(id);

  return {
    data: data.map(serializeDigitalDocumentActivityLog),
    meta: {
      total,
      page,
      lastPage: Math.ceil(total / limit),
    },
  };
};

exports.create = async ({ req, payload, userId }) => {
  if (!userId) {
    throw new AppError("User tidak dikenali", 401);
  }

  const created = await repository.withTransaction(async (client) => {
    const { storage, documentType } = await ensureSupportingData(
      {
        storageId: payload.storage_id,
        documentTypeId: payload.document_type_id,
      },
      client,
    );

    const document = await createDocumentWithGeneratedNumber({
      client,
      payload,
      storage,
      documentType,
      userId,
    });

    await repository.createActivityLog(
      {
        document_id: document.id,
        actor_id: userId,
        action: "CREATED",
        to_storage_id: document.storage_id,
        description: "Dokumen digital dibuat",
      },
      client,
    );

    return document;
  });

  const freshDocument = await repository.findById(created.id, {
    deleted_at: null,
  });

  return serializeDigitalDocumentDetail(
    req,
    await hydrateDocumentMetrics(freshDocument),
  );
};

exports.update = async ({ req, id, payload, userId }) => {
  if (!userId) {
    throw new AppError("User tidak dikenali", 401);
  }

  const current = await repository.findById(id, {
    deleted_at: null,
  });

  if (!current) {
    throw new AppError("Dokumen tidak ditemukan", 404);
  }

  if (current.created_by !== userId) {
    throw new AppError("Hanya pembuat dokumen yang dapat mengubah data", 403);
  }

  const updated = await repository.withTransaction(async (client) => {
    let nextStorage = current.storage;
    let nextDocumentType = current.document_type;

    if (payload.storage_id && payload.storage_id !== current.storage_id) {
      nextStorage = await repository.findStorageById(
        payload.storage_id,
        client,
      );
      if (!nextStorage) {
        throw new AppError("Tempat penyimpanan tidak ditemukan", 404);
      }
    }

    if (
      payload.document_type_id &&
      payload.document_type_id !== current.document_type_id
    ) {
      nextDocumentType = await repository.findDocumentTypeById(
        payload.document_type_id,
        client,
      );
      if (!nextDocumentType) {
        throw new AppError("Jenis dokumen tidak ditemukan", 404);
      }
    }

    const filePayload =
      payload.file !== undefined && payload.file !== null
        ? persistDigitalArchiveFile({
            entity: "documents",
            input: payload.file,
            previousPath: current.file,
            fallbackBaseName: payload.document_name || current.document_name,
          })
        : null;

    const updatePayload = {
      storage_id: nextStorage.id,
      document_type_id: nextDocumentType.id,
      document_name:
        payload.document_name !== undefined
          ? normalizeDocumentName(payload.document_name)
          : current.document_name,
      description:
        payload.description !== undefined
          ? normalizeText(payload.description)
          : current.description,
      is_restricted:
        payload.is_restricted !== undefined
          ? Boolean(payload.is_restricted)
          : current.is_restricted,
      access_level:
        payload.is_restricted !== undefined
          ? payload.is_restricted
            ? "RESTRICT"
            : "NON_RESTRICT"
          : current.access_level,
      file: filePayload ? filePayload.storedPath : current.file,
      updated_by: userId,
    };

    const storageChanged = current.storage_id !== updatePayload.storage_id;
    const fileChanged = Boolean(
      filePayload && filePayload.storedPath !== current.file,
    );
    const hasMetadataChange =
      current.document_type_id !== updatePayload.document_type_id ||
      current.document_name !== updatePayload.document_name ||
      (current.description || null) !== (updatePayload.description || null) ||
      current.is_restricted !== updatePayload.is_restricted;

    const result = await repository.update(id, updatePayload, client);

    if (fileChanged) {
      await repository.clearPrimaryDocumentFiles(id, client);
      await repository.createDocumentFile(
        buildDocumentFilePayload({
          documentId: id,
          storedFile: filePayload,
          originalInput: payload.file,
          uploadedBy: userId,
        }),
        client,
      );
    }

    const logs = buildUpdateLogMessages({
      hasMetadataChange,
      storageChanged,
      fileChanged,
    });

    for (const log of logs) {
      await repository.createActivityLog(
        {
          document_id: result.id,
          actor_id: userId,
          action: log.action,
          from_storage_id: storageChanged ? current.storage_id : null,
          to_storage_id: storageChanged ? updatePayload.storage_id : null,
          description: log.description,
        },
        client,
      );
    }

    return result;
  });

  const freshDocument = await repository.findById(updated.id, {
    deleted_at: null,
  });

  return serializeDigitalDocumentDetail(
    req,
    await hydrateDocumentMetrics(freshDocument),
  );
};

exports.delete = async ({ id, userId }) => {
  if (!userId) {
    throw new AppError("User tidak dikenali", 401);
  }

  const current = await repository.findById(id, {
    deleted_at: null,
  });

  if (!current) {
    throw new AppError("Dokumen tidak ditemukan", 404);
  }

  if (current.created_by !== userId) {
    throw new AppError("Hanya pembuat dokumen yang dapat menghapus data", 403);
  }

  const activeLoan = await repository.findActiveLoanConflict(id);
  if (activeLoan) {
    throw new AppError(
      "Dokumen tidak dapat dihapus karena masih memiliki proses peminjaman aktif",
      409,
    );
  }

  const pendingAccess = await repository.findPendingAccessConflict(id);
  if (pendingAccess) {
    throw new AppError(
      "Dokumen tidak dapat dihapus karena masih memiliki pengajuan akses yang belum diproses",
      409,
    );
  }

  await repository.withTransaction(async (client) => {
    await repository.update(
      id,
      {
        deleted_by: userId,
        deleted_at: new Date(),
      },
      client,
    );

    await repository.createActivityLog(
      {
        document_id: id,
        actor_id: userId,
        action: "DELETED",
        from_storage_id: current.storage_id,
        description: "Dokumen digital dihapus",
      },
      client,
    );
  });
};
