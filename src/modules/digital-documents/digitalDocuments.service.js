const repository = require("./digitalDocuments.repository");
const { AppError } = require("../../utils/errors");
const {
  getDigitalArchiveAccessScope,
  buildDocumentVisibilityWhere,
} = require("../../utils/digital-archive-access");
const {
  deleteStoredFile,
  persistDigitalArchiveFile,
} = require("../../utils/digital-archive-files");
const {
  serializeDigitalDocumentDetail,
  serializeDigitalDocumentSummary,
  serializeDigitalDocumentActivityLog,
} = require("../../utils/digital-archive-serializer");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const {
  enqueueRecordWatermark,
} = require("../watermark-settings/watermarkProcessor.service");
const {
  toSizeBytesBigInt,
  toSizeBytesNumber,
} = require("../../utils/size-bytes");

const DOCUMENT_NUMBER_GENERATION_ATTEMPTS = 25;

async function queueDigitalDocumentWatermark(documentId) {
  try {
    await enqueueRecordWatermark({
      module: "digital_archive",
      entityId: documentId,
    });
  } catch (error) {
    console.error("Failed to queue digital archive watermark:", error);
  }
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;

  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized || null;
}

function normalizeDocumentName(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new AppError("Nama dokumen wajib diisi", 422);
  }

  return normalized;
}

function hasField(source, field) {
  return Object.prototype.hasOwnProperty.call(source || {}, field);
}

function isNonEmptyObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0,
  );
}

function normalizeOptionalId(value) {
  return normalizeText(value);
}

function normalizeUniqueIdArray(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return [];

  const rawItems = Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((item) => item.trim());

  return [...new Set(rawItems.map(normalizeOptionalId).filter(Boolean))];
}

function buildDocumentFilePayload({
  documentId,
  storedFile,
  originalInput,
  uploadedBy,
}) {
  if (!storedFile?.storedPath) return null;

  let sizeBytes = storedFile.sizeBytes ?? null;
  if (sizeBytes === null && originalInput && typeof originalInput === "object") {
    const inputSize = toSizeBytesNumber(
      originalInput.size_bytes || originalInput.sizeBytes,
    );
    if (inputSize && inputSize > 0) {
      sizeBytes = inputSize;
    } else if (Buffer.isBuffer(originalInput.buffer)) {
      sizeBytes = originalInput.buffer.length;
    }
  }

  return {
    document_id: documentId,
    file_path: storedFile.storedPath,
    file_name: storedFile.fileName || null,
    mime_type: storedFile.mimeType || null,
    size_bytes: toSizeBytesBigInt(sizeBytes),
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
      {
        owner: {
          name: {
            contains: normalized,
            mode: "insensitive",
          },
        },
      },
      {
        owner_division: {
          name: {
            contains: normalized,
            mode: "insensitive",
          },
        },
      },
      {
        debtor: {
          name: {
            contains: normalized,
            mode: "insensitive",
          },
        },
      },
      {
        debtor: {
          debtor_number: {
            contains: normalized,
            mode: "insensitive",
          },
        },
      },
      {
        debtor: {
          financing_number: {
            contains: normalized,
            mode: "insensitive",
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
            status: {
              in: ["HANDED_OVER", "BORROWED"],
            },
          },
        },
      };
    case "OVERDUE":
      return {
        loans: {
          some: {
            status: {
              in: ["HANDED_OVER", "BORROWED"],
            },
            requested_due_date: {
              lt: new Date(),
            },
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

  const clauses = [
    {
      deleted_at: null,
    },
    visibilityWhere,
    searchWhere,
    availabilityWhere,
  ];

  if (query.document_type_id) {
    clauses.push({
      document_type_id: query.document_type_id,
    });
  }

  if (query.storage_id) {
    clauses.push({
      storage_id: query.storage_id,
    });
  }

  if (query.office_id) {
    clauses.push({
      storage: {
        cabinet: {
          office_id: query.office_id,
        },
      },
    });
  }

  if (query.cabinet_id) {
    clauses.push({
      storage: {
        cabinet_id: query.cabinet_id,
      },
    });
  }

  if (query.owner_user_id) {
    clauses.push({
      owner_user_id: query.owner_user_id,
    });
  }

  if (query.owner_division_id) {
    clauses.push({
      owner_division_id: query.owner_division_id,
    });
  }

  if (query.debtor_id) {
    clauses.push({
      debtor_id: query.debtor_id,
    });
  }

  if (query.is_restricted !== undefined) {
    const normalized = String(query.is_restricted).trim().toLowerCase();
    if (normalized === "true" || normalized === "false") {
      clauses.push({
        is_restricted: normalized === "true",
      });
    }
  }

  return {
    AND: clauses.filter(isNonEmptyObject),
  };
}

function buildRequestableDocumentWhere(query, scope) {
  if (!scope?.userId || scope.canViewAllDocuments) {
    return {
      id: "__no_requestable_digital_documents__",
    };
  }

  const canAccessRestrictedDocuments = Boolean(
    scope.canAccessRestrictedDocuments ?? scope.canAccessRestricted,
  );
  const clauses = [
    {
      deleted_at: null,
    },
    canAccessRestrictedDocuments ? {} : { access_level: "NON_RESTRICT" },
    {
      NOT: buildDocumentVisibilityWhere(scope),
    },
    buildSearchWhere(query.search),
  ];

  if (query.document_type_id) {
    clauses.push({
      document_type_id: query.document_type_id,
    });
  }

  if (query.owner_division_id) {
    clauses.push({
      owner_division_id: query.owner_division_id,
    });
  }

  if (query.storage_id) {
    clauses.push({
      storage_id: query.storage_id,
    });
  }

  return {
    AND: clauses.filter(isNonEmptyObject),
  };
}

function serializeRequestableDocument(req, document) {
  const summary = serializeDigitalDocumentSummary(req, document);

  return {
    id: summary.id,
    document_number: summary.document_number,
    document_name: summary.document_name,
    description: summary.description,
    document_type: summary.document_type,
    storage: summary.storage,
    owner: summary.owner,
    owner_user: summary.owner_user,
    owner_division: summary.owner_division,
    debtor: summary.debtor,
    availability_status_key: summary.availability_status_key,
    availability_status_label: summary.availability_status_label,
    created_at: summary.created_at,
    updated_at: summary.updated_at,
  };
}

function buildDocumentNumberPrefix(documentType) {
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const typeCode = String(documentType.code).trim().toUpperCase();
  return `${typeCode}-${period}`;
}

function readDocumentNumberSequence(prefix, documentNumber) {
  if (typeof documentNumber !== "string") return 0;

  const expectedPrefix = `${prefix}-`;
  if (!documentNumber.startsWith(expectedPrefix)) return 0;

  const sequence = documentNumber.slice(expectedPrefix.length);
  if (!/^\d+$/.test(sequence)) return 0;

  return Number(sequence);
}

async function generateDocumentNumber(documentType, client, offset = 0) {
  const prefix = buildDocumentNumberPrefix(documentType);
  const existingNumbers = await repository.findDocumentNumbersByPrefix(
    prefix,
    client,
  );
  const latestSequence = existingNumbers.reduce((max, item) => {
    const sequence = readDocumentNumberSequence(prefix, item.document_number);
    return sequence > max ? sequence : max;
  }, 0);
  const nextSequence = latestSequence + 1 + offset;
  return `${prefix}-${String(nextSequence).padStart(4, "0")}`;
}

function isPrismaUniqueError(error) {
  return error && error.code === "P2002";
}

function getPrismaUniqueTargets(error) {
  const target = error?.meta?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === "string") return [target];

  const fallbackSources = [];
  if (typeof error?.message === "string") {
    fallbackSources.push(error.message);
  }

  try {
    fallbackSources.push(JSON.stringify(error?.meta || {}));
  } catch {}

  return fallbackSources.filter(Boolean);
}

function isDocumentNumberUniqueError(error) {
  return (
    isPrismaUniqueError(error) &&
    getPrismaUniqueTargets(error).some((target) =>
      target.toLowerCase().includes("document_number"),
    )
  );
}

function getDebtorPayload(payload) {
  const nested =
    payload.debtor && typeof payload.debtor === "object" ? payload.debtor : {};

  function readField(flatField, nestedField = flatField) {
    if (hasField(payload, flatField)) return normalizeText(payload[flatField]);
    if (hasField(nested, nestedField)) return normalizeText(nested[nestedField]);
    return undefined;
  }

  return {
    debtor_number: readField("debtor_number"),
    name: readField("debtor_name", "name"),
    identity_number: readField("identity_number"),
    financing_number: readField("financing_number"),
    description: readField("debtor_description", "description"),
  };
}

function compactDefinedFields(data) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  );
}

async function resolveDebtorId({ payload, current, client }) {
  const debtorIdProvided = hasField(payload, "debtor_id");
  const rawDebtorId = debtorIdProvided
    ? normalizeOptionalId(payload.debtor_id)
    : undefined;

  if (debtorIdProvided) {
    if (!rawDebtorId) return null;

    const existing = await repository.findDebtorById(rawDebtorId, client);
    if (!existing) {
      throw new AppError("Data debitur tidak ditemukan", 404);
    }

    return existing.id;
  }

  const debtorPayload = getDebtorPayload(payload);
  const hasDebtorData = Object.values(debtorPayload).some(
    (value) => value !== undefined && value !== null,
  );

  if (!hasDebtorData) {
    return current ? current.debtor_id : null;
  }

  let existing = null;
  if (debtorPayload.debtor_number) {
    existing = await repository.findDebtorByDebtorNumber(
      debtorPayload.debtor_number,
      client,
    );
  }

  if (!existing && debtorPayload.identity_number) {
    existing = await repository.findDebtorByIdentityNumber(
      debtorPayload.identity_number,
      client,
    );
  }

  if (!existing && !debtorPayload.name) {
    throw new AppError("Nama debitur wajib diisi", 422);
  }

  const debtorData = compactDefinedFields({
    debtor_number: debtorPayload.debtor_number,
    name: debtorPayload.name,
    identity_number: debtorPayload.identity_number,
    financing_number: debtorPayload.financing_number,
    description: debtorPayload.description,
  });

  if (existing) {
    const updated = await repository.updateDebtor(existing.id, debtorData, client);
    return updated.id;
  }

  const created = await repository.createDebtor(debtorData, client);
  return created.id;
}

async function resolveOwnershipData({ payload, current, userId, client }) {
  const ownerUserProvided = hasField(payload, "owner_user_id");
  const ownerDivisionProvided = hasField(payload, "owner_division_id");
  const relatedUsersProvided = hasField(payload, "related_user_ids");

  let ownerUserId = ownerUserProvided
    ? normalizeOptionalId(payload.owner_user_id)
    : current?.owner_user_id || userId;
  let ownerDivisionId = ownerDivisionProvided
    ? normalizeOptionalId(payload.owner_division_id)
    : current?.owner_division_id || null;

  let ownerUser = null;
  if (ownerUserId) {
    ownerUser = await repository.findUserById(ownerUserId, client);
    if (!ownerUser) {
      throw new AppError("PIC dokumen tidak ditemukan atau tidak aktif", 404);
    }

    if (!ownerDivisionProvided || !ownerDivisionId) {
      ownerDivisionId = ownerUser.division_id;
    }
  }

  if (ownerDivisionId) {
    const division = await repository.findDivisionById(ownerDivisionId, client);
    if (!division) {
      throw new AppError("Divisi pemilik dokumen tidak ditemukan", 404);
    }
  }

  if (
    ownerUser &&
    ownerDivisionId &&
    ownerUser.division_id !== ownerDivisionId
  ) {
    throw new AppError(
      "PIC dokumen harus berada di divisi pemilik dokumen",
      422,
    );
  }

  if (!ownerUserId && !ownerDivisionId) {
    const creator = await repository.findUserById(userId, client);
    ownerUserId = creator?.id || userId;
    ownerDivisionId = creator?.division_id || null;
  }

  let relatedUserIds;
  if (relatedUsersProvided) {
    relatedUserIds = (normalizeUniqueIdArray(payload.related_user_ids) || []).filter(
      (id) => id !== ownerUserId,
    );

    if (relatedUserIds.length) {
      const users = await repository.findUsersByIds(relatedUserIds, client);
      if (users.length !== relatedUserIds.length) {
        throw new AppError(
          "Sebagian user terkait tidak ditemukan atau tidak aktif",
          404,
        );
      }
    }
  }

  return {
    owner_user_id: ownerUserId,
    owner_division_id: ownerDivisionId,
    related_user_ids: relatedUserIds,
  };
}

function canManageDocument(document, scope, userId) {
  if (!document || !userId) return false;
  if (scope?.canManageAllDocuments) return true;

  return document.created_by === userId || document.owner_user_id === userId;
}

async function createDocumentWithGeneratedNumber({
  client,
  payload,
  storage,
  documentType,
  ownership,
  debtorId,
  userId,
  storedFile,
  documentNumberOffset = 0,
}) {
  const normalizedName = normalizeDocumentName(payload.document_name);
  const description = normalizeText(payload.description);

  const documentNumber = await generateDocumentNumber(
    documentType,
    client,
    documentNumberOffset,
  );
  const created = await repository.create(
    {
      storage_id: storage.id,
      document_type_id: documentType.id,
      document_number: documentNumber,
      document_name: normalizedName,
      description,
      file: storedFile.storedPath,
      owner_user_id: ownership.owner_user_id,
      owner_division_id: ownership.owner_division_id,
      debtor_id: debtorId,
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

  await repository.replaceRelatedUsers(
    created.id,
    ownership.related_user_ids || [],
    client,
  );

  return created;
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

exports.getAll = async ({ req, query, userId, scopeOverride = null }) => {
  const scope = scopeOverride || (await getDigitalArchiveAccessScope(userId));
  const where = buildDocumentWhere(query, scope);
  const pagination = resolvePagination(query, {
    ...PAGINATION_PROFILES.TABLE,
    allowAll: true,
  });

  if (pagination.all) {
    const data = await repository.findMany({ where });
    return {
      data: data.map((item) => serializeDigitalDocumentSummary(req, item)),
    };
  }

  const data = await repository.findMany({
    where,
    skip: pagination.skip,
    take: pagination.take,
  });
  const total = await repository.count(where);

  return {
    data: data.map((item) => serializeDigitalDocumentSummary(req, item)),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getRequestable = async ({ req, query, userId }) => {
  const scope = await getDigitalArchiveAccessScope(userId);
  const where = buildRequestableDocumentWhere(query, scope);
  const pagination = resolvePagination(query, {
    ...PAGINATION_PROFILES.TABLE,
    allowAll: true,
  });

  if (pagination.all) {
    const data = await repository.findMany({ where });
    return {
      data: data.map((item) => serializeRequestableDocument(req, item)),
    };
  }

  const data = await repository.findMany({
    where,
    skip: pagination.skip,
    take: pagination.take,
  });
  const total = await repository.count(where);

  return {
    data: data.map((item) => serializeRequestableDocument(req, item)),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getById = async ({ req, id, userId }) => {
  const scope = await getDigitalArchiveAccessScope(userId);
  const visibilityWhere = buildDocumentVisibilityWhere(scope);

  const document = await repository.findById(id, {
    AND: [
      {
        deleted_at: null,
      },
      visibilityWhere,
    ].filter(isNonEmptyObject),
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
    AND: [
      {
        deleted_at: null,
      },
      visibilityWhere,
    ].filter(isNonEmptyObject),
  });

  if (!document) {
    throw new AppError("Dokumen tidak ditemukan", 404);
  }

  const pagination = resolvePagination(query, PAGINATION_PROFILES.HISTORY);

  const data = await repository.findActivityLogsByDocumentId(id, {
    skip: pagination.skip,
    take: pagination.take,
  });
  const total = await repository.countActivityLogsByDocumentId(id);

  return {
    data: data.map(serializeDigitalDocumentActivityLog),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.create = async ({ req, payload, userId }) => {
  if (!userId) {
    throw new AppError("User tidak dikenali", 401);
  }

  const { storage, documentType } = await ensureSupportingData({
    storageId: payload.storage_id,
    documentTypeId: payload.document_type_id,
  });
  const ownership = await resolveOwnershipData({
    payload,
    current: null,
    userId,
  });
  const debtorIdFromPayload = hasField(payload, "debtor_id")
    ? await resolveDebtorId({
        payload,
        current: null,
      })
    : undefined;
  const normalizedName = normalizeDocumentName(payload.document_name);
  const storedFile = persistDigitalArchiveFile({
    entity: "documents",
    input: payload.file,
    fallbackBaseName: normalizedName,
  });

  let created = null;
  try {
    for (
      let offset = 0;
      offset < DOCUMENT_NUMBER_GENERATION_ATTEMPTS;
      offset += 1
    ) {
      try {
        created = await repository.withTransaction(async (client) => {
          const debtorId =
            debtorIdFromPayload !== undefined
              ? debtorIdFromPayload
              : await resolveDebtorId({
                  payload,
                  current: null,
                  client,
                });

          const document = await createDocumentWithGeneratedNumber({
            client,
            payload: {
              ...payload,
              document_name: normalizedName,
            },
            storage,
            documentType,
            ownership,
            debtorId,
            userId,
            storedFile,
            documentNumberOffset: offset,
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
        break;
      } catch (error) {
        if (
          isDocumentNumberUniqueError(error) &&
          offset < DOCUMENT_NUMBER_GENERATION_ATTEMPTS - 1
        ) {
          continue;
        }
        if (isDocumentNumberUniqueError(error)) {
          console.error(
            "Digital document number generation failed after retries:",
            error,
          );
          throw new AppError(
            "Nomor dokumen otomatis bentrok. Silakan coba simpan ulang.",
            409,
          );
        }
        throw error;
      }
    }

    if (!created) {
      throw new AppError("Gagal membuat nomor dokumen otomatis", 500);
    }
  } catch (error) {
    if (storedFile.isNewUpload) {
      deleteStoredFile(storedFile.storedPath);
    }
    throw error;
  }

  const freshDocument = await repository.findById(created.id, {
    deleted_at: null,
  });

  if (freshDocument?.file) {
    await queueDigitalDocumentWatermark(freshDocument.id);
  }

  const serializedDocument = freshDocument?.file
    ? await repository.findById(created.id, {
        deleted_at: null,
      })
    : freshDocument;

  return serializeDigitalDocumentDetail(
    req,
    await hydrateDocumentMetrics(serializedDocument),
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

  const scope = await getDigitalArchiveAccessScope(userId);
  if (!canManageDocument(current, scope, userId)) {
    throw new AppError("Anda tidak memiliki akses untuk mengubah dokumen ini", 403);
  }

  let prevalidatedStorage = current.storage;
  let prevalidatedDocumentType = current.document_type;

  if (payload.storage_id && payload.storage_id !== current.storage_id) {
    prevalidatedStorage = await repository.findStorageById(payload.storage_id);
    if (!prevalidatedStorage) {
      throw new AppError("Tempat penyimpanan tidak ditemukan", 404);
    }
  }

  if (
    payload.document_type_id &&
    payload.document_type_id !== current.document_type_id
  ) {
    prevalidatedDocumentType = await repository.findDocumentTypeById(
      payload.document_type_id,
    );
    if (!prevalidatedDocumentType) {
      throw new AppError("Jenis dokumen tidak ditemukan", 404);
    }
  }

  const ownership = await resolveOwnershipData({
    payload,
    current,
    userId,
  });
  const debtorIdFromPayload = hasField(payload, "debtor_id")
    ? await resolveDebtorId({
        payload,
        current,
      })
    : undefined;
  const filePayload =
    payload.file !== undefined && payload.file !== null
      ? persistDigitalArchiveFile({
          entity: "documents",
          input: payload.file,
          fallbackBaseName: payload.document_name || current.document_name,
        })
      : null;

  let updated;
  try {
    updated = await repository.withTransaction(async (client) => {
      const nextStorage = prevalidatedStorage;
      const nextDocumentType = prevalidatedDocumentType;
      const debtorId =
        debtorIdFromPayload !== undefined
          ? debtorIdFromPayload
          : await resolveDebtorId({
              payload,
              current,
              client,
            });

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
        owner_user_id: ownership.owner_user_id,
        owner_division_id: ownership.owner_division_id,
        debtor_id: debtorId,
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
        current.owner_user_id !== updatePayload.owner_user_id ||
        current.owner_division_id !== updatePayload.owner_division_id ||
        current.debtor_id !== updatePayload.debtor_id ||
        current.is_restricted !== updatePayload.is_restricted;

      const result = await repository.update(id, updatePayload, client);

      if (ownership.related_user_ids !== undefined) {
        await repository.replaceRelatedUsers(
          id,
          ownership.related_user_ids,
          client,
        );
      }

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

      return {
        document: result,
        fileChanged,
      };
    });
  } catch (error) {
    if (filePayload?.isNewUpload) {
      deleteStoredFile(filePayload.storedPath);
    }
    throw error;
  }

  if (updated.fileChanged && filePayload?.isNewUpload && current.file) {
    deleteStoredFile(current.file);
  }

  const freshDocument = await repository.findById(updated.document.id, {
    deleted_at: null,
  });

  if (updated.fileChanged && freshDocument?.file) {
    await queueDigitalDocumentWatermark(freshDocument.id);
  }

  const serializedDocument =
    updated.fileChanged && freshDocument?.file
      ? await repository.findById(updated.document.id, {
          deleted_at: null,
        })
      : freshDocument;

  return serializeDigitalDocumentDetail(
    req,
    await hydrateDocumentMetrics(serializedDocument),
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

  const scope = await getDigitalArchiveAccessScope(userId);
  if (!canManageDocument(current, scope, userId)) {
    throw new AppError("Anda tidak memiliki akses untuk menghapus dokumen ini", 403);
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
