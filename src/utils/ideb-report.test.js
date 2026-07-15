const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateMonthlyCollectibilityHistory,
  buildIdebReportMetrics,
  buildIdebReportSummary,
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

  assert.deepEqual(new Set(accounts("ALL")), new Set([
    "ACTIVE-1",
    "PROBLEM-1",
    "PAID-1",
    "WRITE-OFF-1",
    "PAID-CODE-ONLY",
    "WRITE-OFF-CODE-ONLY",
  ]));
  assert.deepEqual(new Set(accounts("ACTIVE")), new Set(["ACTIVE-1", "PROBLEM-1"]));
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
  assert.equal(metrics.reporterGroups[0].reporterName, "BPRS C");
  assert.equal(metrics.reporterGroups[1].reporterName, "Bank A");
  assert.equal(metrics.reporterGroups[1].facilityCount, 2);
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
