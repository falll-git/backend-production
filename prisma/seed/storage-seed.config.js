const DEFAULT_STORAGE_SEED = Object.freeze({
  officeCode: "KPAM",
  officeName: "Kantor Pusat Artha Madani",
});

function readSeedValue(env, key, fallback) {
  const value = env[key];
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function resolveStorageSeedConfig(env = process.env) {
  return {
    officeCode: readSeedValue(
      env,
      "SEED_STORAGE_OFFICE_CODE",
      DEFAULT_STORAGE_SEED.officeCode,
    ),
    officeName: readSeedValue(
      env,
      "SEED_STORAGE_OFFICE_NAME",
      DEFAULT_STORAGE_SEED.officeName,
    ),
  };
}

module.exports = { DEFAULT_STORAGE_SEED, resolveStorageSeedConfig };
