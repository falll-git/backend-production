const repository = require("./disposition.repository");

exports.getDispositions = async ({ page, limit, search }) => {
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

exports.getDispositionById = async (id) => {
  const disposition = await repository.findById(id);

  if (!disposition) {
    throw new Error("Disposition not found");
  }

  return disposition;
};

exports.createDisposition = async (payload) => {
  const existing = await repository.findByName(payload.name);

  if (existing) {
    throw new Error("Disposition name already exists");
  }

  return repository.create(payload);
};

exports.updateDisposition = async (id, payload) => {
  const disposition = await repository.findById(id);

  if (!disposition) {
    throw new Error("Disposition not found");
  }

  if (payload.name) {
    const existing = await repository.findByName(payload.name);
    if (existing && existing.id !== id) {
      throw new Error("Disposition name already exists");
    }
  }

  return repository.update(id, payload);
};

exports.deleteDisposition = async (id) => {
  const disposition = await repository.findById(id);

  if (!disposition) {
    throw new Error("Disposition not found");
  }

  return repository.delete(id);
};
