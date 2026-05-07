const ROLE_TYPES = {
  MAIN: "MAIN",
  ADDITIONAL: "ADDITIONAL",
};

const ROLE_TYPE_LABELS = {
  [ROLE_TYPES.MAIN]: "Role Utama",
  [ROLE_TYPES.ADDITIONAL]: "Role Tambahan",
};

function normalizeRoleType(value, fallback = ROLE_TYPES.ADDITIONAL) {
  if (value === undefined || value === null || value === "") return fallback;

  const normalized = String(value).trim().toUpperCase();
  if (normalized === "DIVISION") {
    return ROLE_TYPES.ADDITIONAL;
  }

  if (normalized === ROLE_TYPES.MAIN || normalized === ROLE_TYPES.ADDITIONAL) {
    return normalized;
  }

  return null;
}

function getRoleTypeLabel(type) {
  return ROLE_TYPE_LABELS[type] || ROLE_TYPE_LABELS[ROLE_TYPES.ADDITIONAL];
}

function serializeRole(role) {
  if (!role) return role;

  const type = normalizeRoleType(role.type, ROLE_TYPES.ADDITIONAL);

  return {
    ...role,
    type,
    type_label: getRoleTypeLabel(type),
  };
}

module.exports = {
  ROLE_TYPES,
  ROLE_TYPE_LABELS,
  getRoleTypeLabel,
  normalizeRoleType,
  serializeRole,
};
