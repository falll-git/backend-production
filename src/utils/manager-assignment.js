const divisionRepository = require("../modules/division/division.repository");
const userRepository = require("../modules/user/user.repository");

async function resolveActiveDivisionManager(divisionId) {
  const normalizedDivisionId =
    typeof divisionId === "string" ? divisionId.trim() : "";

  if (!normalizedDivisionId) {
    throw new Error("Divisi tujuan wajib diisi");
  }

  const division = await divisionRepository.findById(normalizedDivisionId);

  if (!division) {
    throw new Error("Divisi tujuan tidak ditemukan");
  }

  const managers = await userRepository.findActiveManagersByDivisionId(
    normalizedDivisionId,
    "Manajer",
  );

  if (managers.length === 0) {
    throw new Error(
      `Manajer aktif untuk divisi ${division.name} tidak ditemukan`,
    );
  }

  if (managers.length > 1) {
    throw new Error(
      `Manajer aktif untuk divisi ${division.name} harus tepat satu orang`,
    );
  }

  return {
    division,
    manager: managers[0],
  };
}

module.exports = {
  resolveActiveDivisionManager,
};
