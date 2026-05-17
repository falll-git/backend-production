const repository = require("./role.repository");
const { AppError } = require("../../utils/errors");
const { serializeRole } = require("../../utils/role-types");
const { buildPaginationMeta } = require("../../utils/pagination");

function normalizeName(value) {
  return value.trim().replace(/\s+/g, " ");
}

exports.getRoles = async ({ pagination, search }) => {
  const where = {};

  if (search) {
    where.name = {
      contains: search,
      mode: "insensitive",
    };
  }

  const data = await repository.findMany({
    where,
    skip: pagination.skip,
    take: pagination.take,
  });
  const total = await repository.count(where);

  return {
    data: data.map(serializeRole),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getRoleById = async (id) => {
  const role = await repository.findById(id);

  if (!role) {
    throw new AppError("Role tidak ditemukan.", 404);
  }

  return serializeRole(role);
};

exports.createRole = async (payload) => {
  const normalizedPayload = {
    name: normalizeName(payload.name),
  };

  const existing = await repository.findByName(normalizedPayload.name);

  if (existing) {
    throw new AppError("Nama role sudah digunakan.", 409);
  }

  return serializeRole(await repository.create(normalizedPayload));
};

exports.updateRole = async (id, payload) => {
  const role = await repository.findById(id);

  if (!role) {
    throw new AppError("Role tidak ditemukan.", 404);
  }

  const normalizedPayload = { ...payload };

  if (payload.name) {
    normalizedPayload.name = normalizeName(payload.name);
  }

  if (normalizedPayload.name) {
    const existing = await repository.findByName(normalizedPayload.name);
    if (existing && existing.id !== id) {
      throw new AppError("Nama role sudah digunakan.", 409);
    }
  }

  return serializeRole(await repository.update(id, normalizedPayload));
};

exports.deleteRole = async (id) => {
  const role = await repository.findById(id);

  if (!role) {
    throw new AppError("Role tidak ditemukan.", 404);
  }

  const dependencySummary = await repository.findDependencySummary(id);
  const linkedUsers = dependencySummary?._count?.users || 0;

  if (linkedUsers > 0) {
    throw new AppError(
      "Role tidak dapat dihapus karena masih digunakan oleh pengguna.",
      409,
    );
  }

  return repository.deleteWithRoleMenus(id);
};
