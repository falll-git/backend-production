const storageRepository = require("../modules/storage/storage.repository");
const { AppError } = require("./errors");

function normalizeStorageId(value) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed || null;
}

async function resolveActiveStorageId(storageId) {
  const normalizedStorageId = normalizeStorageId(storageId);

  if (!normalizedStorageId) {
    throw new AppError("Tempat penyimpanan fisik wajib dipilih.", 422);
  }

  const storage = await storageRepository.findById(normalizedStorageId);

  if (!storage || !storage.is_active) {
    throw new AppError(
      "Tempat penyimpanan fisik tidak ditemukan atau tidak aktif.",
      422,
    );
  }

  return storage.id;
}

module.exports = {
  resolveActiveStorageId,
};
