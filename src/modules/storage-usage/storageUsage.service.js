const repository = require("./storageUsage.repository");
const { getStoredFileSizeBytes } = require("../../utils/storage-usage-files");

const DEFAULT_FREE_QUOTA_GB = 500;
const DEFAULT_OVERAGE_PRICE_PER_GB = 0.0023;
const DEFAULT_CURRENCY = "USD";
const GB_BYTES = 1024 ** 3;

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
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatTrendLabel(date) {
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
  });
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveSizeBytes(sizeBytes, storedPath) {
  const parsed = toFiniteNumber(sizeBytes, NaN);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);

  const fallbackSize = getStoredFileSizeBytes(storedPath);
  return fallbackSize && fallbackSize > 0 ? fallbackSize : 0;
}

function addUsageEntry(entries, seenPaths, payload) {
  const storedPath =
    typeof payload.storedPath === "string" && payload.storedPath.trim()
      ? payload.storedPath.trim()
      : null;
  const sizeBytes = resolveSizeBytes(payload.sizeBytes, storedPath);
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

function addWatermarkEntry(entries, seenPaths, record) {
  addUsageEntry(entries, seenPaths, {
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
        addUsageEntry(entries, seenPaths, {
          moduleKey: "digital_archive",
          moduleLabel: MODULE_LABELS.digital_archive,
          storedPath: file.file_path,
          sizeBytes: file.size_bytes,
          createdAt: file.created_at,
        });
      }
    } else {
      addUsageEntry(entries, seenPaths, {
        moduleKey: "digital_archive",
        moduleLabel: MODULE_LABELS.digital_archive,
        storedPath: record.file,
        sizeBytes: null,
        createdAt: record.created_at,
      });
    }

    addWatermarkEntry(entries, seenPaths, record);
  }

  for (const record of incomingMails) {
    addUsageEntry(entries, seenPaths, {
      moduleKey: "incoming_mail",
      moduleLabel: MODULE_LABELS.incoming_mail,
      storedPath: record.file,
      sizeBytes: record.file_size_bytes,
      createdAt: record.created_at,
    });
    addWatermarkEntry(entries, seenPaths, record);
  }

  for (const record of outgoingMails) {
    addUsageEntry(entries, seenPaths, {
      moduleKey: "outgoing_mail",
      moduleLabel: MODULE_LABELS.outgoing_mail,
      storedPath: record.file,
      sizeBytes: record.file_size_bytes,
      createdAt: record.created_at,
    });
    addWatermarkEntry(entries, seenPaths, record);
  }

  for (const record of memorandums) {
    addUsageEntry(entries, seenPaths, {
      moduleKey: "memorandum",
      moduleLabel: MODULE_LABELS.memorandum,
      storedPath: record.file,
      sizeBytes: record.file_size_bytes,
      createdAt: record.created_at,
    });
    addWatermarkEntry(entries, seenPaths, record);
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

function buildTrend(entries, days, freeQuotaGb) {
  const today = startOfLocalDay(new Date());
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - (days - 1));

  const sortedEntries = [...entries].sort(
    (left, right) => left.created_at.getTime() - right.created_at.getTime(),
  );
  let cursor = 0;
  let cumulativeBytes = 0;
  const points = [];

  for (let offset = 0; offset < days; offset += 1) {
    const dayStart = new Date(startDate);
    dayStart.setDate(startDate.getDate() + offset);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayStart.getDate() + 1);

    while (
      cursor < sortedEntries.length &&
      sortedEntries[cursor].created_at < dayEnd
    ) {
      cumulativeBytes += sortedEntries[cursor].size_bytes;
      cursor += 1;
    }

    points.push({
      date: toIsoDate(dayStart),
      label: formatTrendLabel(dayStart),
      used_bytes: cumulativeBytes,
      used_gb: roundNumber(bytesToGb(cumulativeBytes), 4),
      limit_gb: freeQuotaGb,
    });
  }

  return points;
}

function resolveStatus(usedBytes, freeQuotaBytes) {
  const percentage = freeQuotaBytes > 0 ? (usedBytes / freeQuotaBytes) * 100 : 0;

  if (usedBytes > freeQuotaBytes) {
    return {
      status_key: "OVER_LIMIT",
      status_label: "Melewati Kuota",
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
  const usedBytes = entries.reduce((sum, entry) => sum + entry.size_bytes, 0);
  const remainingBytes = Math.max(freeQuotaBytes - usedBytes, 0);
  const overageBytes = Math.max(usedBytes - freeQuotaBytes, 0);
  const overageGb = bytesToGb(overageBytes);
  const status = resolveStatus(usedBytes, freeQuotaBytes);

  return {
    config: {
      free_quota_gb: freeQuotaGb,
      free_quota_bytes: freeQuotaBytes,
      overage_price_per_gb: pricePerGb,
      currency: config.currency || DEFAULT_CURRENCY,
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
      estimated_overage_cost: roundNumber(overageGb * pricePerGb, 4),
      file_count: entries.length,
      ...status,
    },
    breakdown: summarizeBreakdown(entries, usedBytes),
    trend: buildTrend(entries, days, freeQuotaGb),
    updated_at: new Date().toISOString(),
  };
};
