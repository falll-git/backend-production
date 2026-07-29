function normalizeText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

const IDEB_FACILITY_FILTERS = Object.freeze([
  "ALL",
  "ACTIVE",
  "PAID_OFF",
  "PROBLEM",
  "ARREARS",
]);

const IDEB_FACILITY_FILTER_DETAILS = Object.freeze({
  ALL: { label: "Semua", fileSuffix: "semua" },
  ACTIVE: { label: "Aktif", fileSuffix: "aktif" },
  PAID_OFF: { label: "Lunas", fileSuffix: "lunas" },
  PROBLEM: { label: "Macet / Hapus Buku", fileSuffix: "macet-hapus-buku" },
  ARREARS: { label: "Ada Tunggakan", fileSuffix: "ada-tunggakan" },
});

function normalizeIdebFacilityFilter(value) {
  const normalized = normalizeText(value).toUpperCase();
  return IDEB_FACILITY_FILTERS.includes(normalized) ? normalized : "ALL";
}

function idebFacilityFilterDetails(value) {
  return IDEB_FACILITY_FILTER_DETAILS[normalizeIdebFacilityFilter(value)];
}

function recordValue(record, keys) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function parseIdebNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const original = String(value).trim();
  if (!original) return null;
  const negativeByParentheses = /^\(.*\)$/.test(original);
  const compact = original.replace(/[^\d,.-]/g, "").replace(/(?!^)-/g, "");
  if (!compact || compact === "-") return null;

  const negative = negativeByParentheses || compact.startsWith("-");
  const unsigned = compact.replace(/-/g, "");
  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");
  let normalized = unsigned;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = unsigned.split(thousandsSeparator).join("");
    const decimalIndex = normalized.lastIndexOf(decimalSeparator);
    normalized =
      normalized.slice(0, decimalIndex).split(decimalSeparator).join("") +
      "." +
      normalized.slice(decimalIndex + 1);
  } else {
    const separator = lastComma >= 0 ? "," : lastDot >= 0 ? "." : null;
    if (separator) {
      const parts = unsigned.split(separator);
      const isThousands =
        parts.length > 2
          ? parts.slice(1).every((part) => part.length === 3)
          : parts[1]?.length === 3 && parts[0].length > 0;
      if (isThousands) {
        normalized = parts.join("");
      } else if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
        normalized = `${parts[0]}.${parts[1]}`;
      } else {
        normalized = parts.join("");
      }
    }
  }

  const parsed = Number(`${negative ? "-" : ""}${normalized}`);
  return Number.isFinite(parsed) ? parsed : null;
}

function facilityPlafond(facility) {
  return (
    parseIdebNumber(
      recordValue(facility, ["plafond", "initial_plafond", "plafon", "plafon_awal"]),
    ) || 0
  );
}

function facilityInitialPlafond(facility) {
  return (
    parseIdebNumber(
      recordValue(facility, ["initial_plafond", "plafond", "plafon_awal", "plafon"]),
    ) || 0
  );
}

function facilityOutstanding(facility) {
  return (
    parseIdebNumber(
      recordValue(facility, ["outstanding", "baki_debet", "outstanding_pokok"]),
    ) || 0
  );
}

function facilityArrears(facility) {
  return (
    (parseIdebNumber(recordValue(facility, ["principal_arrears", "tunggakan_pokok"])) || 0) +
    (parseIdebNumber(recordValue(facility, ["interest_arrears", "tunggakan_bunga"])) || 0) +
    (parseIdebNumber(recordValue(facility, ["penalty", "denda"])) || 0)
  );
}

function facilityCollectibility(facility) {
  return recordValue(facility, ["collectibility", "collectibility_code", "kol"]);
}

function collectibilityLevel(value) {
  const match = /(?:^|\D)([1-5])(?:\D|$)/.exec(normalizeText(value));
  return match ? Number(match[1]) : null;
}

function facilityDaysPastDue(facility) {
  return parseIdebNumber(
    recordValue(facility, ["days_past_due", "dpd", "jumlah_hari_tunggakan"]),
  );
}

function facilityCondition(facility) {
  return normalizeText(recordValue(facility, ["condition", "condition_code", "status"]));
}

const IDEB_PAID_OFF_CONDITION_CODES = new Set(["02", "05", "06", "12", "17"]);
const IDEB_WRITE_OFF_CONDITION_CODES = new Set(["03", "04"]);

function facilityConditionCode(facility) {
  const explicitCode = normalizeText(
    recordValue(facility, ["condition_code", "kode_kondisi"]),
  ).toUpperCase();
  if (explicitCode) {
    if (/^\d$/.test(explicitCode)) return `0${explicitCode}`;
    const explicitMatch = /^(\d{2})(?:\D|$)/.exec(explicitCode);
    if (explicitMatch) return explicitMatch[1];
  }

  const match = /^(\d{2})(?:\D|$)/.exec(facilityCondition(facility));
  return match ? match[1] : "";
}

function isPaidOffFacility(facility) {
  const code = facilityConditionCode(facility);
  const condition = facilityCondition(facility).toUpperCase();
  return IDEB_PAID_OFF_CONDITION_CODES.has(code) || condition.includes("LUNAS");
}

function isWriteOffFacility(facility) {
  const code = facilityConditionCode(facility);
  const condition = facilityCondition(facility).toUpperCase();
  const compact = condition.replace(/[^A-Z0-9]/g, "");
  return (
    IDEB_WRITE_OFF_CONDITION_CODES.has(code) ||
    compact.includes("HAPUSBUKU") ||
    compact.includes("DIHAPUSBUKUKAN") ||
    compact.includes("HAPUSTAGIH")
  );
}

function classifyFacility(facility) {
  if (isWriteOffFacility(facility)) return "WRITE_OFF";
  if (isPaidOffFacility(facility)) return "PAID_OFF";
  const code = facilityConditionCode(facility);
  if (code) return code === "00" ? "ACTIVE" : "INACTIVE";
  const compactCondition = facilityCondition(facility)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (
    compactCondition === "AKTIF" ||
    compactCondition === "ACTIVE" ||
    compactCondition.includes("FASILITASAKTIF")
  ) {
    return "ACTIVE";
  }
  return "INACTIVE";
}

function facilityRisk(facility) {
  return {
    collectibility: collectibilityLevel(facilityCollectibility(facility)) || 0,
    dpd: facilityDaysPastDue(facility) || 0,
    arrears: facilityArrears(facility),
    outstanding: facilityOutstanding(facility),
    plafond: facilityPlafond(facility),
  };
}

function compareFacilitiesByRisk(left, right) {
    const a = facilityRisk(left);
    const b = facilityRisk(right);
    return (
      b.collectibility - a.collectibility ||
      b.dpd - a.dpd ||
      b.arrears - a.arrears ||
      b.outstanding - a.outstanding ||
      b.plafond - a.plafond ||
      normalizeText(recordValue(left, ["reporter_name", "reporter_code"])).localeCompare(
        normalizeText(recordValue(right, ["reporter_name", "reporter_code"])),
      )
    );
}

function sortFacilitiesByRisk(facilities) {
  return [...facilities].sort(compareFacilitiesByRisk);
}

function facilityLifecycleRank(facility) {
  switch (classifyFacility(facility)) {
    case "ACTIVE":
      return 0;
    case "WRITE_OFF":
      return 1;
    case "INACTIVE":
      return 2;
    case "PAID_OFF":
      return 3;
    default:
      return 4;
  }
}

function sortFacilitiesForAll(facilities) {
  return [...facilities].sort((left, right) => {
    const lifecycleDifference = facilityLifecycleRank(left) - facilityLifecycleRank(right);
    if (lifecycleDifference !== 0) return lifecycleDifference;
    return compareFacilitiesByRisk(left, right);
  });
}

function filterIdebFacilities(facilities, filter = "ALL") {
  const source = Array.isArray(facilities)
    ? facilities.filter(
        (facility) => facility && typeof facility === "object" && !Array.isArray(facility),
      )
    : [];
  const normalizedFilter = normalizeIdebFacilityFilter(filter);

  if (normalizedFilter === "ACTIVE") {
    return sortFacilitiesByRisk(
      source.filter((facility) => classifyFacility(facility) === "ACTIVE"),
    );
  }
  if (normalizedFilter === "PAID_OFF") {
    return sortFacilitiesByRisk(
      source.filter((facility) => classifyFacility(facility) === "PAID_OFF"),
    );
  }
  if (normalizedFilter === "PROBLEM") {
    return sortFacilitiesByRisk(
      source.filter(
        (facility) =>
          classifyFacility(facility) === "WRITE_OFF" ||
          collectibilityLevel(facilityCollectibility(facility)) === 5,
      ),
    );
  }
  if (normalizedFilter === "ARREARS") {
    return sortFacilitiesByRisk(
      source.filter((facility) => facilityArrears(facility) > 0),
    );
  }
  return sortFacilitiesForAll(source);
}

function historyPeriodKey(entry, fallbackIndex) {
  const period = normalizeText(
    recordValue(entry, ["period_month", "period", "month_label", "label"]),
  );
  if (period) return { key: `PERIOD:${period}`, period, order: period };

  const monthIndex = parseIdebNumber(recordValue(entry, ["month_index", "monthIndex"]));
  if (monthIndex !== null) {
    const padded = String(monthIndex).padStart(2, "0");
    return { key: `INDEX:${padded}`, period: null, order: padded };
  }

  const indexKey = String(fallbackIndex + 1).padStart(2, "0");
  return { key: `ROW:${indexKey}`, period: null, order: indexKey };
}

function isMeaningfulHistoryEntry(entry) {
  return Boolean(
    normalizeText(recordValue(entry, ["collectibility_code", "collectibility", "kol"])) ||
      normalizeText(recordValue(entry, ["days_past_due", "dpd", "jumlah_hari_tunggakan"])),
  );
}

function aggregateMonthlyCollectibilityHistory(history = []) {
  const groups = new Map();

  history
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .forEach((entry, index) => {
      if (!isMeaningfulHistoryEntry(entry)) return;

      const periodInfo = historyPeriodKey(entry, index);
      const collectibility =
        recordValue(entry, ["collectibility_code", "collectibility", "kol"]) || null;
      const collectibilityRank = collectibilityLevel(collectibility) || 0;
      const dpd =
        parseIdebNumber(recordValue(entry, ["days_past_due", "dpd", "jumlah_hari_tunggakan"])) ||
        0;
      const sourceCount = Math.max(
        1,
        parseIdebNumber(recordValue(entry, ["source_count"])) || 0,
      );
      const reporterCount =
        parseIdebNumber(recordValue(entry, ["reporter_count"])) || 0;
      const facilityCount =
        parseIdebNumber(recordValue(entry, ["facility_count"])) || 0;
      const reporter = normalizeText(recordValue(entry, ["reporter_name", "reporter_code"]));
      const account = normalizeText(recordValue(entry, ["account_number", "no_rekening"]));

      const current =
        groups.get(periodInfo.key) ||
        ({
          key: periodInfo.key,
          order: periodInfo.order,
          period_month: periodInfo.period,
          month_index: parseIdebNumber(recordValue(entry, ["month_index", "monthIndex"])),
          collectibility: null,
          collectibility_code: null,
          kol: null,
          days_past_due: 0,
          dpd: 0,
          source_count: 0,
          reporterKeys: new Set(),
          accountKeys: new Set(),
          reportedReporterCount: 0,
          reportedFacilityCount: 0,
          bestRank: 0,
        });

      current.source_count += sourceCount;
      if (reporter) current.reporterKeys.add(reporter.toUpperCase());
      if (account) current.accountKeys.add(account.toUpperCase());
      current.reportedReporterCount = Math.max(
        current.reportedReporterCount,
        reporterCount,
      );
      current.reportedFacilityCount = Math.max(
        current.reportedFacilityCount,
        facilityCount,
      );

      if (
        current.collectibility === null ||
        collectibilityRank > current.bestRank
      ) {
        current.bestRank = collectibilityRank;
        current.collectibility = collectibility;
        current.collectibility_code = collectibility;
        current.kol = collectibility;
      }
      current.days_past_due = Math.max(current.days_past_due, dpd);
      current.dpd = current.days_past_due;

      groups.set(periodInfo.key, current);
    });

  return Array.from(groups.values())
    .sort((left, right) => String(left.order).localeCompare(String(right.order)))
    .map((entry) => ({
      period_month: entry.period_month,
      month_index: entry.month_index,
      collectibility: entry.collectibility,
      collectibility_code: entry.collectibility_code,
      kol: entry.kol,
      days_past_due: entry.days_past_due,
      dpd: entry.dpd,
      source_count: entry.source_count,
      reporter_count: Math.max(
        entry.reporterKeys.size,
        entry.reportedReporterCount,
      ),
      facility_count: Math.max(
        entry.accountKeys.size,
        entry.reportedFacilityCount,
      ),
    }));
}

const IDEB_CONCLUSION_MATRIX = Object.freeze({
  GREEN: Object.freeze({
    rule_number: 1,
    rule_code: "ALL_KOL_1_LAST_12_MONTHS",
    indicator: "GREEN",
    indicator_label: "Hijau",
    condition: "Seluruh fasilitas berstatus KOL 1 (Lancar) dalam 12 bulan terakhir.",
    conclusion: "Riwayat pembayaran sangat baik. Lanjutkan ke analisis kapasitas.",
  }),
  YELLOW: Object.freeze({
    rule_number: 2,
    rule_code: "KOL_2_DPD_UNDER_90",
    indicator: "YELLOW",
    indicator_label: "Kuning",
    condition:
      "Terdapat fasilitas KOL 2 (Dalam Perhatian Khusus) dengan akumulasi hari tunggakan (DPD) < 90 hari.",
    conclusion:
      "Butuh klarifikasi/analisis penyebab tunggakan (apakah karena teknis atau finansial).",
  }),
  RED_KOL: Object.freeze({
    rule_number: 3,
    rule_code: "KOL_3_TO_5_LAST_24_MONTHS",
    indicator: "RED",
    indicator_label: "Merah",
    condition:
      "Terdapat fasilitas KOL 3, 4, atau 5 (Macet/Non-Performing Loan) dalam 12-24 bulan terakhir.",
    conclusion:
      "Risiko tinggi. Umumnya ditolak, kecuali ada kebijakan khusus penyelesaian utang.",
  }),
  RED_LEGAL: Object.freeze({
    rule_number: 4,
    rule_code: "WRITE_OFF_OR_LEGAL_DISPUTE",
    indicator: "RED",
    indicator_label: "Merah",
    condition:
      'Terdeteksi status "Hapus Buku" (Write-off) atau sedang dalam proses hukum/sengketa.',
    conclusion: "Debitur memiliki catatan gagal bayar permanen.",
  }),
  UNDETERMINED: Object.freeze({
    rule_number: null,
    rule_code: "UNDETERMINED",
    indicator: "GRAY",
    indicator_label: "Belum Dapat Ditentukan",
    condition: "Belum ada kondisi matrix yang terpenuhi dari data IDEB yang tersedia.",
    conclusion:
      "Data belum cukup atau tidak memenuhi parameter Hijau, Kuning, maupun Merah. Lakukan pemeriksaan manual terhadap data sumber.",
  }),
});

function normalizeIdebPeriodMonth(value) {
  const text = normalizeText(value);
  const match = /^(\d{4})[-/]?(0[1-9]|1[0-2])(?:\D|$)/.exec(text);
  return match ? `${match[1]}-${match[2]}` : null;
}

function idebMonthSerial(periodMonth) {
  const normalized = normalizeIdebPeriodMonth(periodMonth);
  if (!normalized) return null;
  const [year, month] = normalized.split("-").map(Number);
  return year * 12 + month - 1;
}

function idebMonthsAgo(periodMonth, referencePeriod) {
  const periodSerial = idebMonthSerial(periodMonth);
  const referenceSerial = idebMonthSerial(referencePeriod);
  if (periodSerial === null || referenceSerial === null) return null;
  return referenceSerial - periodSerial;
}

function facilityReporterName(facility) {
  return normalizeText(recordValue(facility, ["reporter_name", "reporter_code", "ljk"]));
}

function facilityAccountNumber(facility) {
  return normalizeText(
    recordValue(facility, ["account_number", "facility_number", "no_rekening"]),
  );
}

function createIdebObservation(entry, fallback = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const collectibility = recordValue(entry, ["collectibility", "collectibility_code", "kol"]);
  const level = collectibilityLevel(collectibility);
  if (level === null) return null;
  return {
    period_month:
      normalizeIdebPeriodMonth(
        recordValue(entry, ["period_month", "period", "month_label"]),
      ) || normalizeIdebPeriodMonth(fallback.period_month),
    collectibility,
    level,
    days_past_due: parseIdebNumber(
      recordValue(entry, ["days_past_due", "dpd", "jumlah_hari_tunggakan"]),
    ),
    reporter_name:
      facilityReporterName(entry) || normalizeText(fallback.reporter_name),
    account_number:
      facilityAccountNumber(entry) || normalizeText(fallback.account_number),
    source: normalizeText(fallback.source) || "IDEB",
  };
}

function collectIdebConclusionObservations(summary, facilities) {
  const observations = [];
  const summaryReference =
    normalizeIdebPeriodMonth(summary.period_month) ||
    normalizeIdebPeriodMonth(summary.result_date) ||
    normalizeIdebPeriodMonth(summary.processed_at);

  facilities.forEach((facility) => {
    const fallback = {
      period_month:
        normalizeIdebPeriodMonth(recordValue(facility, ["period_month", "period"])) ||
        summaryReference,
      reporter_name: facilityReporterName(facility),
      account_number: facilityAccountNumber(facility),
      source: "FACILITY",
    };
    const current = createIdebObservation(facility, fallback);
    if (current) observations.push(current);

    const history = Array.isArray(facility.monthly_collectibility_history)
      ? facility.monthly_collectibility_history
      : [];
    history.forEach((entry) => {
      const observation = createIdebObservation(entry, {
        ...fallback,
        source: "FACILITY_HISTORY",
      });
      if (observation) observations.push(observation);
    });
  });

  if (!observations.some((observation) => observation.source === "FACILITY_HISTORY")) {
    const summaryHistory = Array.isArray(summary.monthly_collectibility_history)
      ? summary.monthly_collectibility_history
      : [];
    summaryHistory.forEach((entry) => {
      const observation = createIdebObservation(entry, {
        period_month: summaryReference,
        source: "SUMMARY_HISTORY",
      });
      if (observation) observations.push(observation);
    });
  }

  const unique = new Map();
  observations.forEach((observation) => {
    const key = [
      observation.period_month || "NO_PERIOD",
      observation.reporter_name.toUpperCase(),
      observation.account_number.toUpperCase(),
      observation.level,
      observation.days_past_due ?? "NO_DPD",
    ].join("::");
    if (!unique.has(key)) unique.set(key, observation);
  });
  return [...unique.values()];
}

function resolveIdebConclusionReferencePeriod(summary, observations) {
  const explicit =
    normalizeIdebPeriodMonth(summary.period_month) ||
    normalizeIdebPeriodMonth(summary.result_date) ||
    normalizeIdebPeriodMonth(summary.processed_at);
  if (explicit) return explicit;
  return observations
    .map((entry) => entry.period_month)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

function hasPositiveLegalValue(value) {
  if (value === true || value === 1) return true;
  const normalized = normalizeText(value).toUpperCase();
  if (!normalized) return false;
  if (/\b(TIDAK|BUKAN|TANPA|BEBAS)\b|\bBELUM\s+ADA\b/.test(normalized)) return false;
  return (
    [
      "YA",
      "YES",
      "TRUE",
      "AKTIF",
      "ACTIVE",
      "SEDANG PROSES",
      "SENGKETA",
      "LITIGASI",
      "PROSES HUKUM",
      "PERKARA HUKUM",
    ].includes(normalized) ||
    /\b(PROSES HUKUM|PERKARA HUKUM|DALAM SENGKETA|SEDANG BERSENGKETA|ADA SENGKETA|SENGKETA AKTIF|LITIGASI AKTIF)\b/.test(
      normalized,
    ) ||
    /\b(SENGKETA|LITIGASI)\b.{0,20}\b(AKTIF|BERJALAN|PROSES)\b/.test(normalized)
  );
}

function facilityHasLegalDispute(facility) {
  const explicitFields = [
    "is_in_legal_process",
    "isInLegalProcess",
    "is_disputed",
    "isDisputed",
    "legal_status",
    "legalStatus",
    "legal_process_status",
    "legalProcessStatus",
    "dispute_status",
    "disputeStatus",
  ];
  if (explicitFields.some((key) => hasPositiveLegalValue(facility?.[key]))) return true;
  return ["condition", "problem_reason", "description"]
    .map((key) => facility?.[key])
    .some(hasPositiveLegalValue);
}

function uniqueEvidenceValues(items, key) {
  return [...new Set(items.map((item) => normalizeText(item[key])).filter(Boolean))].slice(0, 10);
}

function conclusionResult(rule, {
  referencePeriod = null,
  matchedFacilities = [],
  matchedObservations = [],
  evidenceText,
  legalProcessDetected = false,
  writeOffDetected = false,
} = {}) {
  const evidenceItems = [...matchedFacilities, ...matchedObservations];
  const dpdValues = evidenceItems
    .map(
      (item) =>
        parseIdebNumber(item.days_past_due) ??
        parseIdebNumber(item.dpd) ??
        facilityDaysPastDue(item),
    )
    .filter((value) => Number.isFinite(value));
  return {
    ...rule,
    reference_period: referencePeriod,
    evidence_text: evidenceText,
    evidence: {
      matched_facility_count: matchedFacilities.length,
      matched_observation_count: matchedObservations.length,
      reporters: uniqueEvidenceValues(
        evidenceItems.map((item) => ({
          reporter_name: item.reporter_name || facilityReporterName(item),
        })),
        "reporter_name",
      ),
      account_numbers: uniqueEvidenceValues(
        evidenceItems.map((item) => ({
          account_number: item.account_number || facilityAccountNumber(item),
        })),
        "account_number",
      ),
      collectibility_levels: [
        ...new Set(
          evidenceItems
            .map(
              (item) =>
                item.level ?? collectibilityLevel(facilityCollectibility(item)),
            )
            .filter(Number.isInteger),
        ),
      ].sort((left, right) => left - right),
      highest_days_past_due: dpdValues.length > 0 ? Math.max(...dpdValues) : null,
      legal_process_detected: legalProcessDetected,
      write_off_detected: writeOffDetected,
    },
  };
}

function buildIdebParameterizedConclusion(summary = {}) {
  const facilities = Array.isArray(summary.facilities)
    ? summary.facilities.filter(
        (item) => item && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  const observations = collectIdebConclusionObservations(summary, facilities);
  const referencePeriod = resolveIdebConclusionReferencePeriod(summary, observations);
  const writeOffFacilities = facilities.filter(isWriteOffFacility);
  const legalFacilities = facilities.filter(facilityHasLegalDispute);

  if (writeOffFacilities.length > 0 || legalFacilities.length > 0) {
    const matchedFacilities = [...new Map(
      [...writeOffFacilities, ...legalFacilities].map((facility, index) => [
        facilityAccountNumber(facility) || `FACILITY:${index}`,
        facility,
      ]),
    ).values()];
    return conclusionResult(IDEB_CONCLUSION_MATRIX.RED_LEGAL, {
      referencePeriod,
      matchedFacilities,
      legalProcessDetected: legalFacilities.length > 0,
      writeOffDetected: writeOffFacilities.length > 0,
      evidenceText: `${writeOffFacilities.length} fasilitas berstatus Hapus Buku/Tagih dan ${legalFacilities.length} fasilitas terindikasi proses hukum/sengketa.`,
    });
  }

  const observationsLast24Months = referencePeriod
    ? observations.filter((observation) => {
        const monthsAgo = idebMonthsAgo(observation.period_month, referencePeriod);
        return monthsAgo !== null && monthsAgo >= 0 && monthsAgo < 24;
      })
    : [];
  const redObservations = observationsLast24Months.filter(
    (observation) => observation.level >= 3 && observation.level <= 5,
  );
  if (redObservations.length > 0) {
    return conclusionResult(IDEB_CONCLUSION_MATRIX.RED_KOL, {
      referencePeriod,
      matchedObservations: redObservations,
      evidenceText: `Ditemukan ${redObservations.length} catatan KOL 3-5 dalam 24 bulan acuan terakhir.`,
    });
  }

  const yellowFacilities = facilities.filter((facility) => {
    const level = collectibilityLevel(facilityCollectibility(facility));
    const dpd = facilityDaysPastDue(facility);
    return level === 2 && dpd !== null && dpd >= 0 && dpd < 90;
  });
  if (yellowFacilities.length > 0) {
    return conclusionResult(IDEB_CONCLUSION_MATRIX.YELLOW, {
      referencePeriod,
      matchedFacilities: yellowFacilities,
      evidenceText: `Ditemukan ${yellowFacilities.length} fasilitas KOL 2 dengan DPD di bawah 90 hari.`,
    });
  }

  const observationsLast12Months = referencePeriod
    ? observations.filter((observation) => {
        const monthsAgo = idebMonthsAgo(observation.period_month, referencePeriod);
        return monthsAgo !== null && monthsAgo >= 0 && monthsAgo < 12;
      })
    : [];
  if (
    observationsLast12Months.length > 0 &&
    observationsLast12Months.every((observation) => observation.level === 1)
  ) {
    const coveredPeriods = new Set(
      observationsLast12Months.map((observation) => observation.period_month).filter(Boolean),
    );
    return conclusionResult(IDEB_CONCLUSION_MATRIX.GREEN, {
      referencePeriod,
      matchedObservations: observationsLast12Months,
      evidenceText: `${observationsLast12Months.length} catatan KOL pada ${coveredPeriods.size} periode dalam 12 bulan acuan seluruhnya KOL 1.`,
    });
  }

  return conclusionResult(IDEB_CONCLUSION_MATRIX.UNDETERMINED, {
    referencePeriod,
    evidenceText:
      referencePeriod === null
        ? "Periode acuan IDEB tidak tersedia."
        : "Tidak ada kondisi Hijau, Kuning, atau Merah yang terpenuhi secara lengkap.",
  });
}

function reporterIdentity(facility) {
  const code = normalizeText(recordValue(facility, ["reporter_code", "ljk"]));
  const name = normalizeText(recordValue(facility, ["reporter_name", "bank"]));
  return {
    key: code ? `CODE:${code.toUpperCase()}` : `NAME:${(name || "TIDAK DIKETAHUI").toUpperCase()}`,
    code: code || null,
    name: name || code || "Tidak diketahui",
  };
}

function emptyReporterGroup(identity) {
  return {
    key: identity.key,
    reporterCode: identity.code,
    reporterName: identity.name,
    facilityCount: 0,
    activeFacilityCount: 0,
    paidOffFacilityCount: 0,
    writeOffFacilityCount: 0,
    inactiveFacilityCount: 0,
    worstCollectibility: null,
    worstCollectibilityLevel: null,
    activeWorstCollectibility: null,
    activeWorstCollectibilityLevel: null,
    activeHighestDaysPastDue: 0,
    highestDaysPastDue: 0,
    totalPlafond: 0,
    totalOutstanding: 0,
    totalArrears: 0,
    activeOutstanding: 0,
    activeArrears: 0,
    paidOffPlafond: 0,
    writeOffPlafond: 0,
    writeOffOutstanding: 0,
    writeOffArrears: 0,
    collateralCount: 0,
    facilities: [],
  };
}

function updateWorstCollectibility(group, facility, active) {
  const value = facilityCollectibility(facility);
  const level = collectibilityLevel(value);
  if (level !== null && (group.worstCollectibilityLevel === null || level > group.worstCollectibilityLevel)) {
    group.worstCollectibilityLevel = level;
    group.worstCollectibility = value;
  }
  if (
    active &&
    level !== null &&
    (group.activeWorstCollectibilityLevel === null || level > group.activeWorstCollectibilityLevel)
  ) {
    group.activeWorstCollectibilityLevel = level;
    group.activeWorstCollectibility = value;
  }
}

function aggregateReporters(facilities) {
  const groups = new Map();

  for (const facility of facilities) {
    const identity = reporterIdentity(facility);
    const group = groups.get(identity.key) || emptyReporterGroup(identity);
    const classification = classifyFacility(facility);
    const plafond = facilityPlafond(facility);
    const outstanding = facilityOutstanding(facility);
    const arrears = facilityArrears(facility);
    const dpd = facilityDaysPastDue(facility) || 0;
    const collaterals = Array.isArray(facility.collaterals) ? facility.collaterals : [];

    group.facilityCount += 1;
    group.totalPlafond += plafond;
    group.totalOutstanding += outstanding;
    group.totalArrears += arrears;
    group.highestDaysPastDue = Math.max(group.highestDaysPastDue, dpd);
    group.collateralCount += collaterals.length;
    group.facilities.push(facility);

    if (classification === "ACTIVE") {
      group.activeFacilityCount += 1;
      group.activeOutstanding += outstanding;
      group.activeArrears += arrears;
      group.activeHighestDaysPastDue = Math.max(group.activeHighestDaysPastDue, dpd);
    } else if (classification === "PAID_OFF") {
      group.paidOffFacilityCount += 1;
      group.paidOffPlafond += plafond;
    } else if (classification === "WRITE_OFF") {
      group.writeOffFacilityCount += 1;
      group.writeOffPlafond += plafond;
      group.writeOffOutstanding += outstanding;
      group.writeOffArrears += arrears;
    } else {
      group.inactiveFacilityCount += 1;
    }

    updateWorstCollectibility(group, facility, classification === "ACTIVE");
    groups.set(identity.key, group);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, facilities: sortFacilitiesByRisk(group.facilities) }))
    .sort(
      (left, right) =>
        Number(right.activeFacilityCount > 0) - Number(left.activeFacilityCount > 0) ||
        (right.activeWorstCollectibilityLevel || 0) -
          (left.activeWorstCollectibilityLevel || 0) ||
        right.activeHighestDaysPastDue - left.activeHighestDaysPastDue ||
        right.activeArrears - left.activeArrears ||
        right.activeOutstanding - left.activeOutstanding ||
        (right.worstCollectibilityLevel || 0) - (left.worstCollectibilityLevel || 0) ||
        right.highestDaysPastDue - left.highestDaysPastDue ||
        right.totalArrears - left.totalArrears ||
        right.totalOutstanding - left.totalOutstanding ||
        right.totalPlafond - left.totalPlafond ||
        left.reporterName.localeCompare(right.reporterName),
    );
}

function maxCollectibility(facilities) {
  return facilities.reduce(
    (current, facility) => {
      const value = facilityCollectibility(facility);
      const level = collectibilityLevel(value);
      if (level === null || level <= current.level) return current;
      return { level, value };
    },
    { level: 0, value: null },
  ).value;
}

function collectNumericWarnings(summary, facilities) {
  const warnings = Array.isArray(summary.data_quality_warnings)
    ? summary.data_quality_warnings.map(normalizeText).filter(Boolean)
    : [];
  const numericFields = [
    ["plafond", "Plafon"],
    ["initial_plafond", "Plafon awal"],
    ["outstanding", "Baki debet"],
    ["days_past_due", "DPD"],
    ["principal_arrears", "Tunggakan pokok"],
    ["interest_arrears", "Tunggakan bunga"],
    ["penalty", "Denda"],
  ];

  facilities.forEach((facility, index) => {
    for (const [key, label] of numericFields) {
      const value = facility[key];
      if (value === undefined || value === null || value === "") continue;
      if (parseIdebNumber(value) === null) {
        warnings.push(`${label} fasilitas ${index + 1} tidak dapat dibaca sebagai angka.`);
      }
    }
  });

  return [...new Set(warnings)].slice(0, 50);
}

function buildIdebReportMetrics(summary = {}) {
  const facilities = Array.isArray(summary.facilities)
    ? summary.facilities.filter(
        (item) => item && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  const stats =
    summary.summary && typeof summary.summary === "object" && !Array.isArray(summary.summary)
      ? summary.summary
      : {};
  const activeFacilities = facilities.filter((facility) => classifyFacility(facility) === "ACTIVE");
  const paidOffFacilities = facilities.filter(
    (facility) => classifyFacility(facility) === "PAID_OFF",
  );
  const writeOffFacilities = facilities.filter(
    (facility) => classifyFacility(facility) === "WRITE_OFF",
  );
  const inactiveFacilities = facilities.filter(
    (facility) => classifyFacility(facility) === "INACTIVE",
  );
  const reporterGroups = aggregateReporters(facilities);
  const reportedReporterCount =
    (parseIdebNumber(stats.bank_creditor_count) || 0) +
    (parseIdebNumber(stats.bpr_bprs_creditor_count) || 0) +
    (parseIdebNumber(stats.lp_creditor_count) || 0) +
    (parseIdebNumber(stats.other_creditor_count) || 0);
  const reportedWorstCollectibility =
    summary.current_collectibility ||
    recordValue(stats, ["worst_collectibility", "worst_collectibility_code"]) ||
    null;
  const calculatedTotalPlafond = facilities.reduce(
    (total, facility) => total + facilityPlafond(facility),
    0,
  );
  const calculatedTotalOutstanding = facilities.reduce(
    (total, facility) => total + facilityOutstanding(facility),
    0,
  );
  const reportedTotalPlafond = parseIdebNumber(
    recordValue(stats, ["total_plafond", "effective_plafond_credit"]),
  );
  const reportedTotalOutstanding =
    parseIdebNumber(recordValue(stats, ["total_outstanding", "outstanding_credit"])) ??
    parseIdebNumber(summary.outstanding_pokok);
  const overallWorstCollectibility = maxCollectibility(facilities);
  const activeWorstCollectibility = maxCollectibility(activeFacilities);
  const parameterizedConclusion = buildIdebParameterizedConclusion(summary);
  const dataQualityWarnings = collectNumericWarnings(summary, facilities);
  const reportedLevel = collectibilityLevel(reportedWorstCollectibility);
  const calculatedLevel = collectibilityLevel(overallWorstCollectibility);
  if (reportedLevel !== null && calculatedLevel !== null && reportedLevel !== calculatedLevel) {
    dataQualityWarnings.push(
      "KOL terburuk pada ringkasan sumber berbeda dengan hasil perhitungan fasilitas.",
    );
  }
  if (reportedReporterCount > 0 && reportedReporterCount !== reporterGroups.length) {
    dataQualityWarnings.push(
      "Jumlah lembaga pada ringkasan sumber berbeda dengan jumlah lembaga dari rincian fasilitas.",
    );
  }
  if (
    reportedTotalPlafond !== null &&
    Math.abs(reportedTotalPlafond - calculatedTotalPlafond) > 1
  ) {
    dataQualityWarnings.push(
      "Total plafon pada ringkasan sumber berbeda dengan hasil penjumlahan fasilitas.",
    );
  }
  if (
    reportedTotalOutstanding !== null &&
    Math.abs(reportedTotalOutstanding - calculatedTotalOutstanding) > 1
  ) {
    dataQualityWarnings.push(
      "Total baki debet pada ringkasan sumber berbeda dengan hasil penjumlahan fasilitas.",
    );
  }
  const worstCollectibility =
    reportedLevel !== null && calculatedLevel !== null
      ? calculatedLevel > reportedLevel
        ? overallWorstCollectibility
        : reportedWorstCollectibility
      : reportedWorstCollectibility || overallWorstCollectibility || null;

  return {
    facilities: sortFacilitiesForAll(facilities),
    activeFacilities: sortFacilitiesByRisk(activeFacilities),
    paidOffFacilities: sortFacilitiesByRisk(paidOffFacilities),
    writeOffFacilities: sortFacilitiesByRisk(writeOffFacilities),
    inactiveFacilities: sortFacilitiesByRisk(inactiveFacilities),
    reporterGroups,
    priorityReporters: reporterGroups.slice(0, 10),
    reporterCount: Math.max(reportedReporterCount, reporterGroups.length),
    derivedReporterCount: reporterGroups.length,
    reportedReporterCount: reportedReporterCount || null,
    officerName: normalizeText(summary.officer_name) || null,
    reportedWorstCollectibility,
    overallWorstCollectibility,
    activeWorstCollectibility,
    parameterizedConclusion,
    worstCollectibility,
    totalPlafond: reportedTotalPlafond ?? calculatedTotalPlafond,
    calculatedTotalPlafond,
    totalOutstanding: reportedTotalOutstanding ?? calculatedTotalOutstanding,
    calculatedTotalOutstanding,
    activeOutstanding: activeFacilities.reduce(
      (total, facility) => total + facilityOutstanding(facility),
      0,
    ),
    activeArrears: activeFacilities.reduce(
      (total, facility) => total + facilityArrears(facility),
      0,
    ),
    totalArrears: facilities.reduce((total, facility) => total + facilityArrears(facility), 0),
    paidOffPlafond: paidOffFacilities.reduce(
      (total, facility) => total + facilityPlafond(facility),
      0,
    ),
    writeOffPlafond: writeOffFacilities.reduce(
      (total, facility) => total + facilityPlafond(facility),
      0,
    ),
    writeOffOutstanding: writeOffFacilities.reduce(
      (total, facility) => total + facilityOutstanding(facility),
      0,
    ),
    writeOffArrears: writeOffFacilities.reduce(
      (total, facility) => total + facilityArrears(facility),
      0,
    ),
    highestDaysPastDue: facilities.reduce(
      (current, facility) => Math.max(current, facilityDaysPastDue(facility) || 0),
      0,
    ),
    dataQualityWarnings,
  };
}

function serializeReporterGroup(group) {
  return {
    key: group.key,
    reporter_code: group.reporterCode,
    reporter_name: group.reporterName,
    facility_count: group.facilityCount,
    active_facility_count: group.activeFacilityCount,
    paid_off_facility_count: group.paidOffFacilityCount,
    write_off_facility_count: group.writeOffFacilityCount,
    inactive_facility_count: group.inactiveFacilityCount,
    worst_collectibility: group.worstCollectibility,
    active_worst_collectibility: group.activeWorstCollectibility,
    highest_days_past_due: group.highestDaysPastDue,
    total_plafond: group.totalPlafond,
    total_outstanding: group.totalOutstanding,
    total_arrears: group.totalArrears,
    active_outstanding: group.activeOutstanding,
    active_arrears: group.activeArrears,
    paid_off_plafond: group.paidOffPlafond,
    write_off_plafond: group.writeOffPlafond,
    write_off_outstanding: group.writeOffOutstanding,
    write_off_arrears: group.writeOffArrears,
    collateral_count: group.collateralCount,
  };
}

function buildIdebReportSummary(metrics, { fallbackCollaterals = [] } = {}) {
  const sourceCollaterals = metrics.facilities.flatMap((facility) =>
    (Array.isArray(facility.collaterals) ? facility.collaterals : []).map(
      (collateral, index) => ({
        ...collateral,
        id:
          collateral.id ||
          collateral.collateral_number ||
          `${recordValue(facility, ["account_number", "no_rekening"]) || "ideb"}-collateral-${index + 1}`,
        source: "IDEB",
        reporter_code: recordValue(facility, ["reporter_code", "ljk"]),
        reporter_name: recordValue(facility, ["reporter_name", "bank"]),
        account_number: recordValue(facility, [
          "account_number",
          "no_rekening",
          "noRekening",
        ]),
      }),
    ),
  );
  const collaterals = sourceCollaterals.length > 0 ? sourceCollaterals : fallbackCollaterals;

  return {
    reporter_count: metrics.reporterCount,
    derived_reporter_count: metrics.derivedReporterCount,
    reported_reporter_count: metrics.reportedReporterCount,
    facilities_count: metrics.facilities.length,
    active_facilities_count: metrics.activeFacilities.length,
    paid_off_facilities_count: metrics.paidOffFacilities.length,
    write_off_facilities_count: metrics.writeOffFacilities.length,
    inactive_facilities_count: metrics.inactiveFacilities.length,
    reported_worst_collectibility: metrics.reportedWorstCollectibility,
    overall_worst_collectibility: metrics.overallWorstCollectibility,
    active_worst_collectibility: metrics.activeWorstCollectibility,
    worst_collectibility: metrics.worstCollectibility,
    highest_days_past_due: metrics.highestDaysPastDue,
    total_plafond: metrics.totalPlafond,
    calculated_total_plafond: metrics.calculatedTotalPlafond,
    total_outstanding: metrics.totalOutstanding,
    calculated_total_outstanding: metrics.calculatedTotalOutstanding,
    active_outstanding: metrics.activeOutstanding,
    active_arrears: metrics.activeArrears,
    total_arrears: metrics.totalArrears,
    paid_off_plafond: metrics.paidOffPlafond,
    write_off_plafond: metrics.writeOffPlafond,
    write_off_outstanding: metrics.writeOffOutstanding,
    write_off_arrears: metrics.writeOffArrears,
    parameterized_conclusion: metrics.parameterizedConclusion,
    reporter_groups: metrics.reporterGroups.map(serializeReporterGroup),
    priority_reporters: metrics.priorityReporters.map(serializeReporterGroup),
    collateral_source: sourceCollaterals.length > 0 ? "IDEB" : collaterals.length > 0 ? "A01" : null,
    collaterals,
    data_quality_warnings: metrics.dataQualityWarnings,
  };
}

module.exports = {
  IDEB_FACILITY_FILTERS,
  aggregateReporters,
  aggregateMonthlyCollectibilityHistory,
  buildIdebParameterizedConclusion,
  buildIdebReportMetrics,
  buildIdebReportSummary,
  classifyFacility,
  collectibilityLevel,
  facilityArrears,
  facilityCollectibility,
  facilityCondition,
  facilityDaysPastDue,
  facilityInitialPlafond,
  facilityOutstanding,
  facilityPlafond,
  filterIdebFacilities,
  idebFacilityFilterDetails,
  isPaidOffFacility,
  isWriteOffFacility,
  normalizeIdebFacilityFilter,
  parseIdebNumber,
  recordValue,
  sortFacilitiesByRisk,
};
