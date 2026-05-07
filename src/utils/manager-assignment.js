const divisionRepository = require("../modules/division/division.repository");
const userRepository = require("../modules/user/user.repository");

async function resolveActiveDivisionManager(divisionId) {
  const normalizedDivisionId =
    typeof divisionId === "string" ? divisionId.trim() : "";

  if (!normalizedDivisionId) {
    throw new Error("Divisi tujuan wajib diisi.");
  }

  const division = await divisionRepository.findById(normalizedDivisionId);

  if (!division) {
    throw new Error("Divisi tujuan tidak ditemukan.");
  }

  const managers = await userRepository.findActiveManagersByDivisionId(
    normalizedDivisionId,
    "Manager",
  );

  if (managers.length === 0) {
    throw new Error(
      `Manager aktif dengan akun teraktivasi untuk divisi ${division.name} tidak ditemukan.`,
    );
  }

  if (managers.length > 1) {
    throw new Error(
      `Manager aktif dengan akun teraktivasi untuk divisi ${division.name} harus tepat satu orang.`,
    );
  }

  return {
    division,
    manager: managers[0],
  };
}

async function resolveActiveDivisionManagers(divisionIds) {
  const normalizedDivisionIds = [
    ...new Set(
      (Array.isArray(divisionIds) ? divisionIds : [divisionIds])
        .map((divisionId) =>
          typeof divisionId === "string" ? divisionId.trim() : "",
        )
        .filter(Boolean),
    ),
  ];

  if (normalizedDivisionIds.length === 0) {
    throw new Error("Minimal satu divisi tujuan wajib diisi.");
  }

  const assignments = [];

  for (const divisionId of normalizedDivisionIds) {
    assignments.push(await resolveActiveDivisionManager(divisionId));
  }

  return assignments;
}

module.exports = {
  resolveActiveDivisionManager,
  resolveActiveDivisionManagers,
};
