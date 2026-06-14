const repository = require("./storageUsage.repository");
const { resolveStoredFileSizeBytes } = require("../../utils/storage-usage-files");

const DEFAULT_FREE_QUOTA_GB = 100;
const DEFAULT_OVERAGE_PRICE_PER_GB = 200;
const DEFAULT_CURRENCY = "IDR";
const DEFAULT_BILLING_MODEL = "TIERED";
const DEFAULT_MANUAL_REVIEW_THRESHOLD_GB = 1000;
const GB_BYTES = 1024 ** 3;

const DEFAULT_PRICING_TIERS = [
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

const MODULE_LABELS = {
  digital_archive: "Arsip Digital",
  incoming_mail: "Surat Masuk",
  outgoing_mail: "Surat Keluar",
  memorandum: "Memorandum",
  watermarked_files: "File Watermark",
};

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundNumber(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((toFiniteNumber(value) + Number.EPSILON) * factor) / factor;
}

function bytesToGb(bytes) {
  return bytes / GB_BYTES;
}

function gbToBytes(gb) {
  return Math.round(toFiniteNumber(gb) * GB_BYTES);
}

function normalizeDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(90, Math.max(7, Math.round(parsed)));
}

function startOfLocalDay(date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function formatTrendLabel(date) {
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function toIsoDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getStorageUsageSource() {
  return process.env.STORAGE_USAGE_SOURCE || "database_file_size";
}

async function resolveSizeBytes(sizeBytes, storedPath) {
  const parsed = toFiniteNumber(sizeBytes, NaN);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);

  const fallbackSize = await resolveStoredFileSizeBytes(storedPath);
  return fallbackSize && fallbackSize > 0 ? fallbackSize : 0;
}

async function addUsageEntry(entries, seenPaths, payload) {
  const storedPath =
    typeof payload.storedPath === "string" && payload.storedPath.trim()
      ? payload.storedPath.trim()
      : null;
  const sizeBytes = await resolveSizeBytes(payload.sizeBytes, storedPath);
  if (sizeBytes <= 0) return;

  const dedupeKey = storedPath || `${payload.moduleKey}:${entries.length}`;
  if (seenPaths.has(dedupeKey)) return;
  seenPaths.add(dedupeKey);

  const createdAt =
    payload.createdAt instanceof Date &&
    !Number.isNaN(payload.createdAt.getTime())
      ? payload.createdAt
      : new Date();

  entries.push({
    module_key: payload.moduleKey,
    module_label: MODULE_LABELS[payload.moduleKey] || payload.moduleLabel,
    stored_path: storedPath,
    size_bytes: sizeBytes,
    created_at: createdAt,
  });
}

async function addWatermarkEntry(entries, seenPaths, record) {
  await addUsageEntry(entries, seenPaths, {
    moduleKey: "watermarked_files",
    moduleLabel: MODULE_LABELS.watermarked_files,
    storedPath: record.watermark_file,
    sizeBytes: record.watermark_file_size_bytes,
    createdAt: record.watermark_applied_at || record.updated_at,
  });
}

async function getActiveConfig() {
  const config = await repository.findActiveConfig();

  if (config) return config;

  return repository.upsertDefaultConfig({
    freeQuotaGb: DEFAULT_FREE_QUOTA_GB,
    overagePricePerGb: DEFAULT_OVERAGE_PRICE_PER_GB,
    currency: DEFAULT_CURRENCY,
    billingModel: DEFAULT_BILLING_MODEL,
    pricingTiers: DEFAULT_PRICING_TIERS,
    manualReviewThresholdGb: DEFAULT_MANUAL_REVIEW_THRESHOLD_GB,
  });
}

async function collectUsageEntries() {
  const [digitalDocuments, incomingMails, outgoingMails, memorandums] =
    await Promise.all([
      repository.findDigitalDocumentUsageRecords(),
      repository.findIncomingMailUsageRecords(),
      repository.findOutgoingMailUsageRecords(),
      repository.findMemorandumUsageRecords(),
    ]);

  const entries = [];
  const seenPaths = new Set();

  for (const record of digitalDocuments) {
    if (record.document_files.length > 0) {
      for (const file of record.document_files) {
        await addUsageEntry(entries, seenPaths, {
          moduleKey: "digital_archive",
          moduleLabel: MODULE_LABELS.digital_archive,
          storedPath: file.file_path,
          sizeBytes: file.size_bytes,
          createdAt: file.created_at,
        });
      }
    } else {
      await addUsageEntry(entries, seenPaths, {
        moduleKey: "digital_archive",
        moduleLabel: MODULE_LABELS.digital_archive,
        storedPath: record.file,
        sizeBytes: null,
        createdAt: record.created_at,
      });
    }

    await addWatermarkEntry(entries, seenPaths, record);
  }

  for (const record of incomingMails) {
    await addUsageEntry(entries, seenPaths, {
      moduleKey: "incoming_mail",
      moduleLabel: MODULE_LABELS.incoming_mail,
      storedPath: record.file,
      sizeBytes: record.file_size_bytes,
      createdAt: record.created_at,
    });
    await addWatermarkEntry(entries, seenPaths, record);
  }

  for (const record of outgoingMails) {
    await addUsageEntry(entries, seenPaths, {
      moduleKey: "outgoing_mail",
      moduleLabel: MODULE_LABELS.outgoing_mail,
      storedPath: record.file,
      sizeBytes: record.file_size_bytes,
      createdAt: record.created_at,
    });
    await addWatermarkEntry(entries, seenPaths, record);
  }

  for (const record of memorandums) {
    await addUsageEntry(entries, seenPaths, {
      moduleKey: "memorandum",
      moduleLabel: MODULE_LABELS.memorandum,
      storedPath: record.file,
      sizeBytes: record.file_size_bytes,
      createdAt: record.created_at,
    });
    await addWatermarkEntry(entries, seenPaths, record);
  }

  return entries;
}

function summarizeBreakdown(entries, totalBytes) {
  const byModule = new Map();

  for (const entry of entries) {
    const current = byModule.get(entry.module_key) || {
      module_key: entry.module_key,
      module_label: entry.module_label,
      used_bytes: 0,
      file_count: 0,
    };

    current.used_bytes += entry.size_bytes;
    current.file_count += 1;
    byModule.set(entry.module_key, current);
  }

  return Array.from(byModule.values())
    .map((item) => ({
      ...item,
      used_gb: roundNumber(bytesToGb(item.used_bytes), 4),
      percentage_of_total:
        totalBytes > 0
          ? roundNumber((item.used_bytes / totalBytes) * 100, 2)
          : 0,
    }))
    .sort((left, right) => right.used_bytes - left.used_bytes);
}

function buildSnapshotPayload({
  snapshotDate,
  usedBytes,
  breakdown,
  fileCount,
  source,
  isEstimated,
}) {
  return {
    snapshotDate,
    usedBytes,
    usedGb: roundNumber(bytesToGb(usedBytes), 4),
    fileCount,
    breakdown,
    source,
    isEstimated,
  };
}

function normalizeSnapshot(snapshot) {
  const snapshotDate =
    snapshot.snapshot_date instanceof Date
      ? startOfLocalDay(snapshot.snapshot_date)
      : startOfLocalDay(new Date(snapshot.snapshot_date));

  return {
    date: toIsoDate(snapshotDate),
    snapshot_date: snapshotDate,
    used_bytes: toFiniteNumber(snapshot.used_bytes, 0),
    used_gb: roundNumber(toFiniteNumber(snapshot.used_gb, 0), 4),
    file_count: toFiniteNumber(snapshot.file_count, 0),
    breakdown: Array.isArray(snapshot.breakdown) ? snapshot.breakdown : [],
    source: snapshot.source || getStorageUsageSource(),
    is_estimated: Boolean(snapshot.is_estimated),
  };
}

async function ensureDailySnapshots({
  startDate,
  endDate,
  currentUsage,
}) {
  const source = getStorageUsageSource();
  const todayPayload = buildSnapshotPayload({
    snapshotDate: endDate,
    usedBytes: currentUsage.usedBytes,
    breakdown: currentUsage.breakdown,
    fileCount: currentUsage.fileCount,
    source,
    isEstimated: false,
  });

  await repository.upsertDailySnapshot(todayPayload);

  const [latestBeforeRange, rangeSnapshots] = await Promise.all([
    repository.findLatestSnapshotBefore(startDate),
    repository.findDailySnapshotsBetween(startDate, endDate),
  ]);
  const snapshotsByDate = new Map(
    rangeSnapshots.map((snapshot) => {
      const normalized = normalizeSnapshot(snapshot);
      return [normalized.date, normalized];
    }),
  );
  let previousSnapshot = latestBeforeRange
    ? normalizeSnapshot(latestBeforeRange)
    : null;

  for (
    let currentDate = new Date(startDate);
    currentDate <= endDate;
    currentDate = addDays(currentDate, 1)
  ) {
    const dateKey = toIsoDate(currentDate);
    const existingSnapshot = snapshotsByDate.get(dateKey);

    if (existingSnapshot) {
      previousSnapshot = existingSnapshot;
      continue;
    }

    const baseSnapshot = previousSnapshot || normalizeSnapshot({
      snapshot_date: endDate,
      used_bytes: currentUsage.usedBytes,
      used_gb: roundNumber(bytesToGb(currentUsage.usedBytes), 4),
      file_count: currentUsage.fileCount,
      breakdown: currentUsage.breakdown,
      source,
      is_estimated: true,
    });
    const estimatedSnapshot = await repository.upsertDailySnapshot(
      buildSnapshotPayload({
        snapshotDate: currentDate,
        usedBytes: baseSnapshot.used_bytes,
        breakdown: baseSnapshot.breakdown,
        fileCount: baseSnapshot.file_count,
        source: baseSnapshot.source,
        isEstimated: true,
      }),
    );
    const normalizedEstimated = normalizeSnapshot(estimatedSnapshot);
    snapshotsByDate.set(dateKey, normalizedEstimated);
    previousSnapshot = normalizedEstimated;
  }

  return Array.from(snapshotsByDate.values()).sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

async function buildTrendFromSnapshots({ days, freeQuotaGb, currentUsage }) {
  const today = startOfLocalDay(new Date());
  const startDate = addDays(today, -(days - 1));
  const snapshots = await ensureDailySnapshots({
    startDate,
    endDate: today,
    currentUsage,
  });
  let previousUsedBytes = snapshots[0]?.used_bytes ?? 0;

  return snapshots.map((snapshot, index) => {
    const snapshotDate = new Date(`${snapshot.date}T00:00:00Z`);
    const deltaBytes =
      index === 0 ? 0 : snapshot.used_bytes - previousUsedBytes;
    previousUsedBytes = snapshot.used_bytes;

    return {
      date: snapshot.date,
      label: formatTrendLabel(snapshotDate),
      used_bytes: snapshot.used_bytes,
      used_gb: roundNumber(bytesToGb(snapshot.used_bytes), 4),
      file_count: snapshot.file_count,
      delta_bytes: deltaBytes,
      delta_gb: roundNumber(bytesToGb(deltaBytes), 4),
      limit_gb: freeQuotaGb,
      is_estimated: snapshot.is_estimated,
    };
  });
}

function resolveStatus(usedBytes, freeQuotaBytes) {
  const percentage = freeQuotaBytes > 0 ? (usedBytes / freeQuotaBytes) * 100 : 0;

  if (usedBytes > freeQuotaBytes) {
    return {
      status_key: "OVER_LIMIT",
      status_label: "Melewati Kuota / Argo berjalan",
    };
  }

  if (percentage >= 90) {
    return {
      status_key: "NEAR_LIMIT",
      status_label: "Mendekati Limit",
    };
  }

  return {
    status_key: "SAFE",
    status_label: "Aman",
  };
}

function normalizePricingTiers(value) {
  const source = Array.isArray(value) && value.length > 0 ? value : DEFAULT_PRICING_TIERS;

  const tiers = source
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const fromGb = toFiniteNumber(item.from_gb, NaN);
      const toGb = item.to_gb === null ? null : toFiniteNumber(item.to_gb, NaN);
      const pricePerGb = toFiniteNumber(item.price_per_gb, NaN);

      if (!Number.isFinite(fromGb) || !Number.isFinite(pricePerGb)) return null;
      if (toGb !== null && (!Number.isFinite(toGb) || toGb <= fromGb)) return null;

      return {
        from_gb: fromGb,
        to_gb: toGb,
        price_per_gb: pricePerGb,
        label:
          typeof item.label === "string" && item.label.trim()
            ? item.label.trim()
            : toGb === null
              ? `> ${fromGb} GB`
              : `${fromGb}-${toGb} GB`,
        description:
          typeof item.description === "string" && item.description.trim()
            ? item.description.trim()
            : pricePerGb > 0
              ? `Rp ${pricePerGb}/GB/bulan`
              : "Gratis",
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.from_gb - right.from_gb);

  return tiers.length > 0 ? tiers : DEFAULT_PRICING_TIERS;
}

function calculateTieredBilling({ usedBytes, freeQuotaGb, pricingTiers, manualReviewThresholdGb }) {
  const usedGbExact = bytesToGb(usedBytes);
  const reviewThresholdGb = Math.max(
    freeQuotaGb,
    toFiniteNumber(manualReviewThresholdGb, DEFAULT_MANUAL_REVIEW_THRESHOLD_GB),
  );
  const automaticUsageGb = Math.min(usedGbExact, reviewThresholdGb);
  const unpricedGb = Math.max(usedGbExact - reviewThresholdGb, 0);
  let totalCost = 0;

  const tierBreakdown = pricingTiers.map((tier) => {
    const tierToGb = tier.to_gb === null ? reviewThresholdGb : Math.min(tier.to_gb, reviewThresholdGb);
    const usedInTierGb = Math.max(
      Math.min(automaticUsageGb, tierToGb) - tier.from_gb,
      0,
    );
    const cost = usedInTierGb * tier.price_per_gb;
    totalCost += cost;

    return {
      ...tier,
      used_gb: roundNumber(usedInTierGb, 4),
      billable_gb: tier.price_per_gb > 0 ? roundNumber(usedInTierGb, 4) : 0,
      cost: roundNumber(cost, 2),
    };
  });

  return {
    billing_model: DEFAULT_BILLING_MODEL,
    free_quota_gb: freeQuotaGb,
    billable_gb: roundNumber(Math.max(automaticUsageGb - freeQuotaGb, 0), 4),
    priced_usage_gb: roundNumber(automaticUsageGb, 4),
    unpriced_gb: roundNumber(unpricedGb, 4),
    manual_review_threshold_gb: reviewThresholdGb,
    manual_review_required: unpricedGb > 0,
    estimated_cost: roundNumber(totalCost, 2),
    tier_breakdown: tierBreakdown,
  };
}

exports.getSummary = async ({ query = {} } = {}) => {
  const days = normalizeDays(query.days);
  const [config, entries] = await Promise.all([
    getActiveConfig(),
    collectUsageEntries(),
  ]);

  const freeQuotaGb = toFiniteNumber(config.free_quota_gb, DEFAULT_FREE_QUOTA_GB);
  const freeQuotaBytes = gbToBytes(freeQuotaGb);
  const pricePerGb = toFiniteNumber(
    config.overage_price_per_gb,
    DEFAULT_OVERAGE_PRICE_PER_GB,
  );
  const billingModel =
    typeof config.billing_model === "string" && config.billing_model.trim()
      ? config.billing_model.trim().toUpperCase()
      : DEFAULT_BILLING_MODEL;
  const pricingTiers = normalizePricingTiers(config.pricing_tiers);
  const manualReviewThresholdGb = toFiniteNumber(
    config.manual_review_threshold_gb,
    DEFAULT_MANUAL_REVIEW_THRESHOLD_GB,
  );
  const usedBytes = entries.reduce((sum, entry) => sum + entry.size_bytes, 0);
  const remainingBytes = Math.max(freeQuotaBytes - usedBytes, 0);
  const overageBytes = Math.max(usedBytes - freeQuotaBytes, 0);
  const overageGb = bytesToGb(overageBytes);
  const status = resolveStatus(usedBytes, freeQuotaBytes);
  const breakdown = summarizeBreakdown(entries, usedBytes);
  const currentUsage = {
    usedBytes,
    fileCount: entries.length,
    breakdown,
  };
  const billing = calculateTieredBilling({
    usedBytes,
    freeQuotaGb,
    pricingTiers,
    manualReviewThresholdGb,
  });
  const trend = await buildTrendFromSnapshots({
    days,
    freeQuotaGb,
    currentUsage,
  });

  return {
    config: {
      free_quota_gb: freeQuotaGb,
      free_quota_bytes: freeQuotaBytes,
      overage_price_per_gb: pricePerGb,
      currency: config.currency || DEFAULT_CURRENCY,
      billing_model: billingModel,
      pricing_tiers: pricingTiers,
      manual_review_threshold_gb: manualReviewThresholdGb,
      source: getStorageUsageSource(),
    },
    usage: {
      used_bytes: usedBytes,
      used_gb: roundNumber(bytesToGb(usedBytes), 4),
      used_percentage:
        freeQuotaBytes > 0
          ? roundNumber((usedBytes / freeQuotaBytes) * 100, 2)
          : 0,
      remaining_bytes: remainingBytes,
      remaining_gb: roundNumber(bytesToGb(remainingBytes), 2),
      overage_bytes: overageBytes,
      overage_gb: roundNumber(overageGb, 2),
      estimated_overage_cost: billing.estimated_cost,
      billable_gb: billing.billable_gb,
      manual_review_required: billing.manual_review_required,
      unpriced_gb: billing.unpriced_gb,
      file_count: entries.length,
      ...status,
    },
    breakdown,
    trend,
    billing,
    updated_at: new Date().toISOString(),
  };
};
