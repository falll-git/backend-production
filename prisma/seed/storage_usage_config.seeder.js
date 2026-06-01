const prisma = require("../../src/config/prisma");

const DEFAULT_STORAGE_PRICING_TIERS = [
  {
    from_gb: 0,
    to_gb: 100,
    price_per_gb: 0,
    label: "0-100 GB",
    description: "Gratis",
  },
  {
    from_gb: 100,
    to_gb: 500,
    price_per_gb: 200,
    label: "100-500 GB",
    description: "Rp 200/GB/bulan",
  },
  {
    from_gb: 500,
    to_gb: 1000,
    price_per_gb: 150,
    label: "500-1000 GB",
    description: "Rp 150/GB/bulan",
  },
];

const DEFAULT_STORAGE_USAGE_CONFIG = {
  id: "storage-usage-config-default",
  free_quota_gb: 100,
  overage_price_per_gb: 200,
  currency: "IDR",
  billing_model: "TIERED",
  pricing_tiers: DEFAULT_STORAGE_PRICING_TIERS,
  manual_review_threshold_gb: 1000,
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
      billing_model: DEFAULT_STORAGE_USAGE_CONFIG.billing_model,
      pricing_tiers: DEFAULT_STORAGE_USAGE_CONFIG.pricing_tiers,
      manual_review_threshold_gb:
        DEFAULT_STORAGE_USAGE_CONFIG.manual_review_threshold_gb,
      is_active: DEFAULT_STORAGE_USAGE_CONFIG.is_active,
    },
    create: DEFAULT_STORAGE_USAGE_CONFIG,
  });

  console.log("Storage usage config seeded!");
}

module.exports = { seedStorageUsageConfig };
