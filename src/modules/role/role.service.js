const repository = require("./role.repository");
const { AppError } = require("../../utils/errors");

function normalizeName(value) {
  return value.trim().replace(/\s+/g, " ");
}

exports.getRoles = async ({ page, limit, search }) => {
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

exports.getRoleById = async (id) => {
  const role = await repository.findById(id);

  if (!role) {
    throw new Error("Role not found");
  }

  return role;
};

exports.createRole = async (payload) => {
  const normalizedPayload = {
    name: normalizeName(payload.name),
  };

  const existing = await repository.findByName(normalizedPayload.name);

  if (existing) {
    throw new AppError("Role name already exists", 409);
  }

  return repository.create(normalizedPayload);
};

exports.updateRole = async (id, payload) => {
  const role = await repository.findById(id);

  if (!role) {
    throw new AppError("Role not found", 404);
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
      throw new AppError("Role name already exists", 409);
    }
  }

  return repository.update(id, normalizedPayload);
};

exports.deleteRole = async (id) => {
  const role = await repository.findById(id);

  if (!role) {
    throw new AppError("Role not found", 404);
  }

  const dependencySummary = await repository.findDependencySummary(id);
  const linkedUsers = dependencySummary?._count?.users || 0;
  const linkedRoleMenus = dependencySummary?._count?.roles_menus || 0;

  if (linkedUsers > 0 || linkedRoleMenus > 0) {
    throw new AppError(
      "Role cannot be deleted because it is still used by users or menu access settings",
      409,
    );
  }

  return repository.delete(id);
};
