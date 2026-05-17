const prisma = require("../../src/config/prisma");

const DEFAULT_STORAGE_USAGE_CONFIG = {
  id: "storage-usage-config-default",
  free_quota_gb: 500,
  overage_price_per_gb: 0.0023,
  currency: "USD",
  is_active: true,
};

async function seedStorageUsageConfig() {
  console.log("Seeding storage usage config...");

  await prisma.storage_usage_configs.upsert({
    where: {
      id: DEFAULT_STORAGE_USAGE_CONFIG.id,
    },
    update: {
      free_quota_gb: DEFAULT_STORAGE_USAGE_CONFIG.free_quota_gb,
      overage_price_per_gb: DEFAULT_STORAGE_USAGE_CONFIG.overage_price_per_gb,
      currency: DEFAULT_STORAGE_USAGE_CONFIG.currency,
      is_active: DEFAULT_STORAGE_USAGE_CONFIG.is_active,
    },
    create: DEFAULT_STORAGE_USAGE_CONFIG,
  });

  console.log("Storage usage config seeded!");
}

module.exports = { seedStorageUsageConfig };
