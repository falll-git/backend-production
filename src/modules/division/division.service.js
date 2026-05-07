const repository = require("./division.repository");
const { AppError } = require("../../utils/errors");

function normalizeDivisionName(name) {
  return name.trim().replace(/\s+/g, " ");
}

exports.getDivision = async ({ page, limit, search }) => {
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

exports.getDivisionById = async (id) => {
  const division = await repository.findById(id);

  if (!division) {
    throw new AppError("Divisi tidak ditemukan.", 404);
  }

  return division;
};

exports.createDivision = async (payload) => {
  const normalizedName = normalizeDivisionName(payload.name);
  const existing = await repository.findByName(normalizedName);

  if (existing) {
    throw new AppError("Nama divisi sudah digunakan.", 409);
  }

  return repository.create({
    ...payload,
    name: normalizedName,
  });
};

exports.updateDivision = async (id, payload) => {
  const division = await repository.findById(id);

  if (!division) {
    throw new AppError("Divisi tidak ditemukan.", 404);
  }

  const nextData = { ...payload };

  if (payload.name) {
    nextData.name = normalizeDivisionName(payload.name);
    const existing = await repository.findByName(nextData.name);
    if (existing && existing.id !== id) {
      throw new AppError("Nama divisi sudah digunakan.", 409);
    }
  }

  return repository.update(id, nextData);
};

exports.deleteDivision = async (id) => {
  const division = await repository.findById(id);

  if (!division) {
    throw new AppError("Divisi tidak ditemukan.", 404);
  }

  const dependencySummary = await repository.findDependencySummary(id);
  const totalDependencies = Object.values(
    dependencySummary?._count || {},
  ).reduce((total, count) => total + Number(count || 0), 0);

  if (totalDependencies > 0) {
    throw new AppError(
      "Divisi tidak dapat dihapus karena masih digunakan oleh pengguna, surat masuk, atau memorandum.",
      409,
    );
  }

  return repository.delete(id);
};
