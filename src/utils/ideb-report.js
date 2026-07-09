function normalizeText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
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

function isPaidOffFacility(facility) {
  const code = normalizeText(recordValue(facility, ["condition_code"])).toUpperCase();
  const condition = facilityCondition(facility).toUpperCase();
  return code === "02" || condition === "02" || condition.startsWith("02 ") || condition.includes("LUNAS");
}

function isWriteOffFacility(facility) {
  const code = normalizeText(recordValue(facility, ["condition_code"])).toUpperCase();
  const condition = facilityCondition(facility).toUpperCase();
  const compact = condition.replace(/[^A-Z0-9]/g, "");
  return (
    code === "03" ||
    condition === "03" ||
    condition.startsWith("03 ") ||
    compact.includes("HAPUSBUKU") ||
    compact.includes("DIHAPUSBUKUKAN")
  );
}

function classifyFacility(facility) {
  if (isWriteOffFacility(facility)) return "WRITE_OFF";
  if (isPaidOffFacility(facility)) return "PAID_OFF";
  return "ACTIVE";
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

function sortFacilitiesByRisk(facilities) {
  return [...facilities].sort((left, right) => {
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
  });
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
    worstCollectibility: null,
    worstCollectibilityLevel: null,
    activeWorstCollectibility: null,
    activeWorstCollectibilityLevel: null,
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
    } else if (classification === "PAID_OFF") {
      group.paidOffFacilityCount += 1;
      group.paidOffPlafond += plafond;
    } else {
      group.writeOffFacilityCount += 1;
      group.writeOffPlafond += plafond;
      group.writeOffOutstanding += outstanding;
      group.writeOffArrears += arrears;
    }

    updateWorstCollectibility(group, facility, classification === "ACTIVE");
    groups.set(identity.key, group);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, facilities: sortFacilitiesByRisk(group.facilities) }))
    .sort(
      (left, right) =>
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
    facilities: sortFacilitiesByRisk(facilities),
    activeFacilities: sortFacilitiesByRisk(activeFacilities),
    paidOffFacilities: sortFacilitiesByRisk(paidOffFacilities),
    writeOffFacilities: sortFacilitiesByRisk(writeOffFacilities),
    reporterGroups,
    priorityReporters: reporterGroups.slice(0, 10),
    reporterCount: Math.max(reportedReporterCount, reporterGroups.length),
    derivedReporterCount: reporterGroups.length,
    reportedReporterCount: reportedReporterCount || null,
    officerName: normalizeText(summary.officer_name) || null,
    reportedWorstCollectibility,
    overallWorstCollectibility,
    activeWorstCollectibility,
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
    reporter_groups: metrics.reporterGroups.map(serializeReporterGroup),
    priority_reporters: metrics.priorityReporters.map(serializeReporterGroup),
    collateral_source: sourceCollaterals.length > 0 ? "IDEB" : collaterals.length > 0 ? "A01" : null,
    collaterals,
    data_quality_warnings: metrics.dataQualityWarnings,
  };
}

module.exports = {
  aggregateReporters,
  aggregateMonthlyCollectibilityHistory,
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
  isPaidOffFacility,
  isWriteOffFacility,
  parseIdebNumber,
  recordValue,
  sortFacilitiesByRisk,
};
