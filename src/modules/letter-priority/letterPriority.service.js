const repository = require("./letterPriority.repository");
const { AppError } = require("../../utils/errors");

function normalizeName(value) {
  return value.trim().replace(/\s+/g, " ");
}

exports.getLetterPriorities = async ({ page, limit, search }) => {
  const skip = (page - 1) * limit;

  const where = search
    ? {
        name: {
          contains: search,
          mode: "insensitive",
        },
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

exports.getLetterPriorityById = async (id) => {
  const letterPriority = await repository.findById(id);

  if (!letterPriority) {
    throw new AppError("Letter priority not found", 404);
  }

  return letterPriority;
};

exports.createLetterPriority = async (payload) => {
  const normalizedPayload = {
    ...payload,
    name: normalizeName(payload.name),
  };

  const existing = await repository.findByName(normalizedPayload.name);

  if (existing) {
    throw new AppError("Letter priority name already exists", 409);
  }

  return repository.create(normalizedPayload);
};

exports.updateLetterPriority = async (id, payload) => {
  const letterPriority = await repository.findById(id);

  if (!letterPriority) {
    throw new AppError("Letter priority not found", 404);
  }

  const normalizedPayload = payload.name
    ? {
        ...payload,
        name: normalizeName(payload.name),
      }
    : payload;

  if (normalizedPayload.name) {
    const existing = await repository.findByName(normalizedPayload.name);
    if (existing && existing.id !== id) {
      throw new AppError("Letter priority name already exists", 409);
    }
  }

  return repository.update(id, normalizedPayload);
};

exports.deleteLetterPriority = async (id) => {
  const letterPriority = await repository.findById(id);

  if (!letterPriority) {
    throw new AppError("Letter priority not found", 404);
  }

  const dependencySummary = await repository.findDependencySummary(id);
  const linkedIncomingMails = dependencySummary?._count?.incoming_mails || 0;
  const linkedOutgoingMails = dependencySummary?._count?.outgoing_mails || 0;

  if (linkedIncomingMails > 0 || linkedOutgoingMails > 0) {
    throw new AppError(
      "Letter priority cannot be deleted because it is still used by incoming or outgoing mails",
      409,
    );
  }

  return repository.delete(id);
};
