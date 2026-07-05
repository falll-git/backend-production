const divisionRepository = require("../modules/division/division.repository");
const userRepository = require("../modules/user/user.repository");
const { DIVISION_MANAGER_FEATURE } = require("./menu-access");

const DISPOSITION_MANAGER_MENU_URLS = [
  "/dashboard/manajemen-surat/kelola-surat/input-surat-masuk",
  "/dashboard/manajemen-surat/kelola-surat/input-memorandum",
];

async function resolveActiveDivisionManagersForDivision(
  divisionId,
  menuUrls = DISPOSITION_MANAGER_MENU_URLS,
) {
  const normalizedDivisionId =
    typeof divisionId === "string" ? divisionId.trim() : "";

  if (!normalizedDivisionId) {
    throw new Error("Divisi tujuan wajib diisi.");
  }

  const division = await divisionRepository.findById(normalizedDivisionId);

  if (!division) {
    throw new Error("Divisi tujuan tidak ditemukan.");
  }

  const managers = await userRepository.findActiveUsersByDivisionRoleFeature({
    divisionId: normalizedDivisionId,
    menuUrls,
    feature: DIVISION_MANAGER_FEATURE,
  });

  if (managers.length === 0) {
    throw new Error(
      `Penerima disposisi divisi yang aktif untuk divisi ${division.name} tidak ditemukan.`,
    );
  }

  return {
    division,
    managers,
  };
}

function normalizeDivisionIds(divisionIds) {
  return [
    ...new Set(
      (Array.isArray(divisionIds) ? divisionIds : [divisionIds])
        .map((divisionId) =>
          typeof divisionId === "string" ? divisionId.trim() : "",
        )
        .filter(Boolean),
    ),
  ];
}

function isSameUser(left, right) {
  return Boolean(left && right && String(left) === String(right));
}

async function resolveActiveDivisionManagerGroups(
  divisionIds,
  menuUrls = DISPOSITION_MANAGER_MENU_URLS,
) {
  const normalizedDivisionIds = [
    ...normalizeDivisionIds(divisionIds),
  ];

  if (normalizedDivisionIds.length === 0) {
    throw new Error("Minimal satu divisi tujuan wajib diisi.");
  }

  const groups = [];

  for (const divisionId of normalizedDivisionIds) {
    groups.push(
      await resolveActiveDivisionManagersForDivision(divisionId, menuUrls),
    );
  }

  return groups;
}

async function resolveActiveDivisionManagers(divisionIds, options = {}) {
  const groups = await resolveActiveDivisionManagerGroups(
    divisionIds,
    options.menuUrls ?? DISPOSITION_MANAGER_MENU_URLS,
  );
  const assignments = [];
  const excludeUserId = options.excludeUserId ?? null;

  for (const { division, managers } of groups) {
    const eligibleManagers = excludeUserId
      ? managers.filter((manager) => !isSameUser(manager.id, excludeUserId))
      : managers;

    if (eligibleManagers.length === 0) {
      throw new Error(
        `Penerima disposisi divisi yang aktif untuk divisi ${division.name} tidak ditemukan selain pembuat.`,
      );
    }

    for (const manager of eligibleManagers) {
      assignments.push({
        division,
        manager,
        managers: eligibleManagers,
      });
    }
  }

  return assignments;
}

function buildTargetDivisionDataFromAssignments(assignments) {
  const groupedByDivision = new Map();

  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    if (!assignment?.division?.id || !assignment?.manager?.id) continue;

    const current = groupedByDivision.get(assignment.division.id) ?? {
      division_id: assignment.division.id,
      managers: [],
      managerIds: new Set(),
    };

    if (!current.managerIds.has(assignment.manager.id)) {
      current.managerIds.add(assignment.manager.id);
      current.managers.push(assignment.manager);
    }

    groupedByDivision.set(assignment.division.id, current);
  }

  return Array.from(groupedByDivision.values()).map((group) => ({
    division_id: group.division_id,
    manager_id: group.managers.length === 1 ? group.managers[0].id : null,
  }));
}

module.exports = {
  buildTargetDivisionDataFromAssignments,
  resolveActiveDivisionManagers,
};
