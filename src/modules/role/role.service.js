const repository = require("./role.repository");
const { AppError } = require("../../utils/errors");
const {
  ROLE_TYPES,
  normalizeRoleType,
  serializeRole,
} = require("../../utils/role-types");

function normalizeName(value) {
  return value.trim().replace(/\s+/g, " ");
}

function resolveOptionalRoleType(value) {
  if (value === undefined || value === null || value === "") return null;

  const type = normalizeRoleType(value, null);
  if (!type) {
    throw new AppError("Tipe role harus Role Utama atau Role Tambahan.", 422);
  }

  return type;
}

exports.getRoles = async ({ page, limit, search, type }) => {
  const skip = (page - 1) * limit;
  const normalizedType = resolveOptionalRoleType(type);
  const where = {};

  if (search) {
    where.name = {
      contains: search,
      mode: "insensitive",
    };
  }

  if (normalizedType) {
    where.type = normalizedType;
  }

  const data = await repository.findMany({ where, skip, take: limit });
  const total = await repository.count(where);

  return {
    data: data.map(serializeRole),
    meta: {
      total,
      page,
      lastPage: Math.ceil(total / limit),
    },
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
  const type = normalizeRoleType(payload.type, ROLE_TYPES.ADDITIONAL);
  if (!type) {
    throw new AppError("Tipe role harus Role Utama atau Role Tambahan.", 422);
  }

  const normalizedPayload = {
    name: normalizeName(payload.name),
    type,
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

  if (payload.type !== undefined) {
    const type = normalizeRoleType(payload.type, null);
    if (!type) {
      throw new AppError("Tipe role harus Role Utama atau Role Tambahan.", 422);
    }
    normalizedPayload.type = type;
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
  const linkedRoleMenus = dependencySummary?._count?.roles_menus || 0;

  if (linkedUsers > 0 || linkedRoleMenus > 0) {
    throw new AppError(
      "Role tidak dapat dihapus karena masih digunakan oleh pengguna atau pengaturan akses menu.",
      409,
    );
  }

  return repository.delete(id);
};
