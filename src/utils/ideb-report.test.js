const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateMonthlyCollectibilityHistory,
  buildIdebParameterizedConclusion,
  buildIdebReportMetrics,
  buildIdebReportSummary,
  classifyFacility,
  filterIdebFacilities,
  normalizeIdebFacilityFilter,
  parseIdebNumber,
} = require("./ideb-report");

test("parseIdebNumber supports common Indonesian and international formats", () => {
  assert.equal(parseIdebNumber(25000000), 25000000);
  assert.equal(parseIdebNumber("25.000.000"), 25000000);
  assert.equal(parseIdebNumber("25,000,000"), 25000000);
  assert.equal(parseIdebNumber("25.000.000,50"), 25000000.5);
  assert.equal(parseIdebNumber("25,000,000.50"), 25000000.5);
  assert.equal(parseIdebNumber("Rp 1.250.000"), 1250000);
  assert.equal(parseIdebNumber("invalid"), null);
});

test("facility filters use the same lifecycle and risk rules as the IDEB resume", () => {
  const facilities = [
    {
      account_number: "ACTIVE-1",
      collectibility: "1 - Lancar",
      outstanding: "5.000.000",
      condition_code: "00",
    },
    {
      account_number: "PROBLEM-1",
      collectibility: "5 - Macet",
      outstanding: "3.000.000",
      principal_arrears: "500.000",
      condition_code: "00",
    },
    {
      account_number: "PAID-1",
      collectibility: "1 - Lancar",
      outstanding: "0",
      condition_code: "02",
      condition: "02 - Lunas",
    },
    {
      account_number: "WRITE-OFF-1",
      collectibility: "5 - Macet",
      outstanding: "2.000.000",
      condition_code: "03",
      condition: "03 - Hapus Buku",
    },
    {
      account_number: "PAID-CODE-ONLY",
      collectibility: "1 - Lancar",
      outstanding: "0",
      condition_code: "02",
      condition: "Aktif",
    },
    {
      account_number: "WRITE-OFF-CODE-ONLY",
      collectibility: "1 - Lancar",
      outstanding: "1.000.000",
      condition_code: "03",
      condition: "Aktif",
    },
  ];
  const accounts = (filter) =>
    filterIdebFacilities(facilities, filter).map((facility) => facility.account_number);

  assert.deepEqual(accounts("ALL"), [
    "PROBLEM-1",
    "ACTIVE-1",
    "WRITE-OFF-1",
    "WRITE-OFF-CODE-ONLY",
    "PAID-1",
    "PAID-CODE-ONLY",
  ]);
  assert.deepEqual(accounts("ACTIVE"), ["PROBLEM-1", "ACTIVE-1"]);
  assert.deepEqual(new Set(accounts("PAID_OFF")), new Set(["PAID-1", "PAID-CODE-ONLY"]));
  assert.deepEqual(new Set(accounts("PROBLEM")), new Set([
    "PROBLEM-1",
    "WRITE-OFF-1",
    "WRITE-OFF-CODE-ONLY",
  ]));
  assert.deepEqual(accounts("ARREARS"), ["PROBLEM-1"]);
  assert.equal(normalizeIdebFacilityFilter(" active "), "ACTIVE");
  assert.equal(normalizeIdebFacilityFilter("unknown"), "ALL");
});

test("only explicit active SLIK conditions contribute to active IDEB metrics", () => {
  const expected = new Map([
    ["00", "ACTIVE"],
    ["01", "INACTIVE"],
    ["02", "PAID_OFF"],
    ["03", "WRITE_OFF"],
    ["04", "WRITE_OFF"],
    ["05", "PAID_OFF"],
    ["06", "PAID_OFF"],
    ["07", "INACTIVE"],
    ["08", "INACTIVE"],
    ["09", "INACTIVE"],
    ["10", "INACTIVE"],
    ["11", "INACTIVE"],
    ["12", "PAID_OFF"],
    ["13", "INACTIVE"],
    ["14", "INACTIVE"],
    ["15", "INACTIVE"],
    ["16", "INACTIVE"],
    ["17", "PAID_OFF"],
  ]);

  expected.forEach((classification, conditionCode) => {
    assert.equal(classifyFacility({ condition_code: conditionCode }), classification);
  });
  assert.equal(classifyFacility({ condition: "Fasilitas Aktif" }), "ACTIVE");
  assert.equal(classifyFacility({ condition_code: "00 - Fasilitas Aktif" }), "ACTIVE");
  assert.equal(classifyFacility({ condition: "Status tidak diketahui" }), "INACTIVE");
  assert.equal(
    classifyFacility({ condition_code: "01", condition: "Fasilitas Aktif" }),
    "INACTIVE",
  );

  const metrics = buildIdebReportMetrics({
    facilities: [
      { condition_code: "00", collectibility: "2 - DPK" },
      { condition_code: "05", collectibility: "5 - Macet" },
      { condition_code: "01", collectibility: "4 - Diragukan" },
    ],
  });
  assert.equal(metrics.activeFacilities.length, 1);
  assert.equal(metrics.inactiveFacilities.length, 1);
  assert.equal(metrics.writeOffFacilities.length, 0);
  assert.equal(metrics.activeWorstCollectibility, "2 - DPK");
});

test("parameterized IDEB conclusion returns green only when all observed KOL in 12 months are KOL 1", () => {
  const result = buildIdebParameterizedConclusion({
    period_month: "2026-07",
    facilities: [
      {
        reporter_name: "Bank A",
        account_number: "A-1",
        condition_code: "00",
        collectibility: "1 - Lancar",
        period_month: "2026-07",
        monthly_collectibility_history: [
          { period_month: "2025-08", collectibility: "1", days_past_due: 0 },
          { period_month: "2026-01", collectibility: "1", days_past_due: 0 },
        ],
      },
      {
        reporter_name: "Bank B",
        account_number: "B-1",
        condition_code: "02",
        collectibility: "1 - Lancar",
        period_month: "2026-07",
      },
    ],
  });

  assert.equal(result.rule_code, "ALL_KOL_1_LAST_12_MONTHS");
  assert.equal(result.indicator, "GREEN");
  assert.equal(result.reference_period, "2026-07");
  assert.deepEqual(result.evidence.collectibility_levels, [1]);
});

test("parameterized IDEB conclusion applies the KOL 2 DPD boundary without guessing missing DPD", () => {
  const yellow = buildIdebParameterizedConclusion({
    period_month: "2026-07",
    facilities: [
      {
        reporter_name: "Bank A",
        account_number: "A-1",
        condition_code: "00",
        collectibility: "2 - DPK",
        days_past_due: 89,
      },
    ],
  });
  const atBoundary = buildIdebParameterizedConclusion({
    period_month: "2026-07",
    facilities: [{ condition_code: "00", collectibility: "2", days_past_due: 90 }],
  });
  const missingDpd = buildIdebParameterizedConclusion({
    period_month: "2026-07",
    facilities: [{ condition_code: "00", collectibility: "2" }],
  });

  assert.equal(yellow.rule_code, "KOL_2_DPD_UNDER_90");
  assert.equal(yellow.indicator, "YELLOW");
  assert.equal(yellow.evidence.highest_days_past_due, 89);
  assert.equal(atBoundary.rule_code, "UNDETERMINED");
  assert.equal(missingDpd.rule_code, "UNDETERMINED");
});

test("parameterized IDEB conclusion detects KOL 3-5 inside the 24 month reference window", () => {
  const insideWindow = buildIdebParameterizedConclusion({
    period_month: "2026-07",
    facilities: [
      {
        condition_code: "00",
        collectibility: "1",
        period_month: "2026-07",
        monthly_collectibility_history: [
          { period_month: "2024-08", collectibility: "3", days_past_due: 95 },
        ],
      },
    ],
  });
  const outsideWindow = buildIdebParameterizedConclusion({
    period_month: "2026-07",
    facilities: [
      {
        condition_code: "00",
        collectibility: "1",
        period_month: "2026-07",
        monthly_collectibility_history: [
          { period_month: "2024-07", collectibility: "5", days_past_due: 200 },
        ],
      },
    ],
  });

  assert.equal(insideWindow.rule_code, "KOL_3_TO_5_LAST_24_MONTHS");
  assert.equal(insideWindow.indicator, "RED");
  assert.equal(outsideWindow.rule_code, "ALL_KOL_1_LAST_12_MONTHS");
});

test("write-off or explicit legal dispute has the highest conclusion priority", () => {
  const writeOff = buildIdebParameterizedConclusion({
    period_month: "2026-07",
    facilities: [
      {
        reporter_name: "Bank A",
        account_number: "A-1",
        condition_code: "03",
        collectibility: "1",
      },
      {
        condition_code: "00",
        collectibility: "2",
        days_past_due: 10,
      },
    ],
  });
  const legal = buildIdebParameterizedConclusion({
    period_month: "2026-07",
    facilities: [
      {
        condition_code: "00",
        collectibility: "1",
        legal_status: "Sedang proses hukum",
      },
    ],
  });
  const negativeLegalText = buildIdebParameterizedConclusion({
    period_month: "2026-07",
    facilities: [
      {
        condition_code: "00",
        collectibility: "1",
        description: "Tidak ada sengketa",
      },
    ],
  });
  const notYetDisputed = buildIdebParameterizedConclusion({
    period_month: "2026-07",
    facilities: [
      {
        condition_code: "00",
        collectibility: "1",
        description: "Belum ada sengketa",
      },
    ],
  });

  assert.equal(writeOff.rule_code, "WRITE_OFF_OR_LEGAL_DISPUTE");
  assert.equal(writeOff.evidence.write_off_detected, true);
  assert.equal(legal.rule_code, "WRITE_OFF_OR_LEGAL_DISPUTE");
  assert.equal(legal.evidence.legal_process_detected, true);
  assert.equal(negativeLegalText.rule_code, "ALL_KOL_1_LAST_12_MONTHS");
  assert.equal(notYetDisputed.rule_code, "ALL_KOL_1_LAST_12_MONTHS");
});

test("buildIdebReportMetrics groups facilities by reporter and separates lifecycle totals", () => {
  const metrics = buildIdebReportMetrics({
    current_collectibility: "4 - Diragukan",
    facilities: [
      {
        reporter_code: "001",
        reporter_name: "Bank A",
        account_number: "A-1",
        collectibility: "2 - DPK",
        days_past_due: "15",
        plafond: "10.000.000",
        outstanding: "8.000.000",
        principal_arrears: "500.000",
        condition_code: "00",
      },
      {
        reporter_code: "001",
        reporter_name: "Bank A",
        account_number: "A-2",
        collectibility: "4 - Diragukan",
        days_past_due: "95",
        plafond: "5.000.000",
        outstanding: "4.000.000",
        interest_arrears: "250.000",
        condition_code: "00",
      },
      {
        reporter_code: "002",
        reporter_name: "Bank B",
        account_number: "B-1",
        collectibility: "1 - Lancar",
        plafond: "7.000.000",
        outstanding: "0",
        condition_code: "02",
        condition: "02 - Lunas",
      },
      {
        reporter_code: "003",
        reporter_name: "BPRS C",
        account_number: "C-1",
        collectibility: "5 - Macet",
        days_past_due: "200",
        plafond: "3.000.000",
        outstanding: "2.000.000",
        principal_arrears: "1.000.000",
        condition_code: "03",
        condition: "03 - Hapus Buku",
      },
    ],
  });

  assert.equal(metrics.reporterGroups.length, 3);
  assert.equal(metrics.reporterGroups[0].reporterName, "Bank A");
  assert.equal(metrics.reporterGroups[0].facilityCount, 2);
  assert.equal(metrics.reporterGroups[1].reporterName, "BPRS C");
  assert.equal(metrics.activeFacilities.length, 2);
  assert.equal(metrics.paidOffFacilities.length, 1);
  assert.equal(metrics.writeOffFacilities.length, 1);
  assert.equal(metrics.activeOutstanding, 12000000);
  assert.equal(metrics.activeArrears, 750000);
  assert.equal(metrics.writeOffOutstanding, 2000000);
  assert.equal(metrics.writeOffPlafond, 3000000);
  assert.equal(metrics.activeWorstCollectibility, "4 - Diragukan");
  assert.equal(metrics.overallWorstCollectibility, "5 - Macet");
  assert.equal(metrics.worstCollectibility, "5 - Macet");
  assert.equal(metrics.parameterizedConclusion.rule_code, "WRITE_OFF_OR_LEGAL_DISPUTE");
  assert.ok(
    metrics.dataQualityWarnings.includes(
      "KOL terburuk pada ringkasan sumber berbeda dengan hasil perhitungan fasilitas.",
    ),
  );
  assert.equal(metrics.highestDaysPastDue, 200);
});

test("priorityReporters limits the resume to ten institutions, not ten facilities", () => {
  const facilities = Array.from({ length: 12 }, (_, index) => ({
    reporter_code: String(index + 1).padStart(3, "0"),
    reporter_name: `Lembaga ${index + 1}`,
    collectibility: String((index % 5) + 1),
    days_past_due: index,
    plafond: 1000 + index,
    outstanding: 500 + index,
    condition_code: "00",
  }));
  facilities.push({
    ...facilities[0],
    account_number: "tambahan",
  });

  const metrics = buildIdebReportMetrics({ facilities });
  assert.equal(metrics.reporterGroups.length, 12);
  assert.equal(metrics.priorityReporters.length, 10);
  const firstReporter = metrics.reporterGroups.find(
    (item) => item.reporterCode === "001",
  );
  assert.equal(firstReporter.facilityCount, 2);
});

test("buildIdebReportSummary keeps facility context on IDEB collateral", () => {
  const metrics = buildIdebReportMetrics({
    facilities: [
      {
        reporter_code: "001",
        reporter_name: "Bank A",
        account_number: "A-1",
        condition_code: "00",
        collaterals: [{ collateral_number: "AG-1", type: "Sertifikat" }],
      },
    ],
  });
  const summary = buildIdebReportSummary(metrics);

  assert.equal(summary.collateral_source, "IDEB");
  assert.equal(summary.collaterals[0].reporter_code, "001");
  assert.equal(summary.collaterals[0].reporter_name, "Bank A");
  assert.equal(summary.collaterals[0].account_number, "A-1");
  assert.equal(summary.parameterized_conclusion.rule_code, "UNDETERMINED");
});

test("monthly IDEB history keeps the worst KOL and highest DPD independently", () => {
  const result = aggregateMonthlyCollectibilityHistory([
    {
      period_month: "2026-05",
      collectibility: "1",
      days_past_due: 90,
      reporter_name: "Pelapor A",
      account_number: "A-1",
    },
    {
      period_month: "2026-05",
      collectibility: "3",
      days_past_due: 5,
      reporter_name: "Pelapor B",
      account_number: "B-1",
    },
    {
      period_month: "2026-05",
      collectibility: "2",
      days_past_due: 120,
      reporter_name: "Pelapor C",
      account_number: "C-1",
    },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].collectibility, "3");
  assert.equal(result[0].days_past_due, 120);
  assert.equal(result[0].source_count, 3);
  assert.equal(result[0].reporter_count, 3);
  assert.equal(result[0].facility_count, 3);
});

test("monthly IDEB history preserves counts when an aggregated row is processed again", () => {
  const firstPass = aggregateMonthlyCollectibilityHistory([
    {
      period_month: "2026-06",
      collectibility: "5",
      days_past_due: 12,
      source_count: 4,
      reporter_count: 3,
      facility_count: 4,
    },
  ]);
  const secondPass = aggregateMonthlyCollectibilityHistory(firstPass);

  assert.deepEqual(secondPass, firstPass);
});

test("monthly IDEB history ignores rows without KOL or DPD values", () => {
  const result = aggregateMonthlyCollectibilityHistory([
    { period_month: "2026-05", reporter_name: "Pelapor A" },
    { period_month: "2026-06", collectibility: "2" },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].period_month, "2026-06");
  assert.equal(result[0].collectibility, "2");
});

test("monthly IDEB history preserves a descriptive KOL without a numeric code", () => {
  const result = aggregateMonthlyCollectibilityHistory([
    { period_month: "2026-07", collectibility: "Lancar" },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].collectibility, "Lancar");
});

test("monthly IDEB history groups legacy rows by month index when period is absent", () => {
  const result = aggregateMonthlyCollectibilityHistory([
    { month_index: 1, collectibility: "1", reporter_name: "Pelapor A" },
    { month_index: 1, collectibility: "4", reporter_name: "Pelapor B" },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].month_index, 1);
  assert.equal(result[0].collectibility, "4");
  assert.equal(result[0].source_count, 2);
});
