const repository = require("./documentType.repository");
const { AppError } = require("../../utils/errors");

function normalizeText(value) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeCode(value) {
  return value.trim().toUpperCase();
}

exports.getDocumentTypes = async ({ page, limit, search }) => {
  const skip = (page - 1) * limit;

  const where = search
    ? {
        OR: [
          {
            code: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            name: {
              contains: search,
              mode: "insensitive",
            },
          },
        ],
      }
    : {};

  const data = await repository.findMany({ where, skip, take: limit });
  const total = await repository.count(where);

  return {
    data,
    meta: {
      total,
      page,
      lastPage: Math.ceil(total / limit),
    },
  };
};

exports.getDocumentTypeById = async (id) => {
  const documentType = await repository.findById(id);

  if (!documentType) {
    throw new AppError("Document type not found", 404);
  }

  return documentType;
};

exports.createDocumentType = async (payload) => {
  const normalizedPayload = {
    ...payload,
    code: normalizeCode(payload.code),
    name: normalizeText(payload.name),
    description: payload.description?.trim() || null,
  };

  const existingByCode = await repository.findByCode(normalizedPayload.code);
  const existingByName = await repository.findByName(normalizedPayload.name);

  if (existingByCode) {
    throw new AppError("Document type code already exists", 409);
  }

  if (existingByName) {
    throw new AppError("Document type name already exists", 409);
  }

  return repository.create(normalizedPayload);
};

exports.updateDocumentType = async (id, payload) => {
  const documentType = await repository.findById(id);

  if (!documentType) {
    throw new AppError("Document type not found", 404);
  }

  const normalizedPayload = {
    ...payload,
    ...(payload.code ? { code: normalizeCode(payload.code) } : {}),
    ...(payload.name ? { name: normalizeText(payload.name) } : {}),
    ...(payload.description !== undefined
      ? { description: payload.description?.trim() || null }
      : {}),
  };

  if (normalizedPayload.code) {
    const existingByCode = await repository.findByCode(normalizedPayload.code);
    if (existingByCode && existingByCode.id !== id) {
      throw new AppError("Document type code already exists", 409);
    }
  }

  if (normalizedPayload.name) {
    const existingByName = await repository.findByName(normalizedPayload.name);
    if (existingByName && existingByName.id !== id) {
      throw new AppError("Document type name already exists", 409);
    }
  }

  return repository.update(id, normalizedPayload);
};

exports.deleteDocumentType = async (id) => {
  const documentType = await repository.findById(id);

  if (!documentType) {
    throw new AppError("Document type not found", 404);
  }

  const dependencySummary = await repository.findDependencySummary(id);
  const linkedDocuments = dependencySummary?._count?.digital_documents || 0;

  if (linkedDocuments > 0) {
    throw new AppError(
      "Document type cannot be deleted because it is still used by digital documents",
      409,
    );
  }

  return repository.delete(id);
};
