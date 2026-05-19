const repository = require("./debtorReports.repository");

function number(value) {
  return Number(value || 0);
}

function roundPercent(value) {
  return Math.round(value * 10000) / 100;
}

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
}

function calculateRemainingMonths(value) {
  if (!value) return 0;
  const dueDate = new Date(value);
  if (Number.isNaN(dueDate.getTime())) return 0;
  const today = new Date();
  if (dueDate <= today) return 0;
  const yearDiff = dueDate.getFullYear() - today.getFullYear();
  const monthDiff = dueDate.getMonth() - today.getMonth();
  const baseMonths = yearDiff * 12 + monthDiff;
  return Math.max(baseMonths + (dueDate.getDate() > today.getDate() ? 1 : 0), 0);
}

exports.getSummary = async () => {
  const [totalDebtors, activeDebtors, activeContracts, closedContracts] =
    await Promise.all([
      repository.countDebtors({ deleted_at: null }),
      repository.countDebtors({ deleted_at: null, status: "ACTIVE" }),
      repository.countContracts({
        deleted_at: null,
        status: { in: ["ACTIVE", "AKTIF", "BERJALAN"] },
      }),
      repository.countContracts({
        deleted_at: null,
        status: { in: ["CLOSED", "LUNAS", "SELESAI"] },
      }),
    ]);

  return {
    total_debtors: totalDebtors,
    active_debtors: activeDebtors,
    inactive_debtors: Math.max(totalDebtors - activeDebtors, 0),
    active_contracts: activeContracts,
    closed_contracts: closedContracts,
  };
};

exports.getNpf = async (query = {}) => {
  const [contracts, trendRows] = await Promise.all([
    repository.findContractsForNpf(),
    repository.findCollectibilityTrendRows({
      from: query.from_period,
      to: query.to_period,
    }),
  ]);
  const breakdownByKol = new Map();
  const details = [];
  let numerator = 0;
  let denominator = 0;

  for (const contract of contracts) {
    const outstanding =
      number(contract.outstanding_pokok) + number(contract.outstanding_margin);
    const latestKol = contract.collectibilities?.[0]?.kol_level || null;
    const key = latestKol?.level ?? "UNMAPPED";
    const existing = breakdownByKol.get(key) || {
      level: latestKol?.level ?? null,
      code: latestKol?.code ?? null,
      name: latestKol?.name ?? "Belum ada kolektibilitas",
      contract_count: 0,
      outstanding: 0,
      is_npf: false,
    };

    const isNpf =
      latestKol?.is_npf === true ||
      (Number.isFinite(Number(latestKol?.level)) && Number(latestKol.level) >= 3);
    existing.contract_count += 1;
    existing.outstanding += outstanding;
    existing.is_npf = existing.is_npf || isNpf;
    breakdownByKol.set(key, existing);

    denominator += outstanding;
    if (isNpf) numerator += outstanding;

    details.push({
      debtor_id: contract.debtor?.id ?? null,
      debtor_number: contract.debtor?.debtor_number ?? null,
      debtor_name: contract.debtor?.name ?? "-",
      contract_id: contract.id,
      contract_number: contract.no_kontrak,
      level: latestKol?.level ?? null,
      code: latestKol?.code ?? null,
      name: latestKol?.name ?? "Belum ada kolektibilitas",
      outstanding,
      outstanding_pokok: number(contract.outstanding_pokok),
      outstanding_margin: number(contract.outstanding_margin),
      remaining_months: calculateRemainingMonths(contract.tanggal_jatuh_tempo),
      is_npf: isNpf,
    });
  }

  const trendByPeriod = new Map();
  for (const row of trendRows) {
    const outstanding = number(row.outstanding_pokok) + number(row.outstanding_margin);
    const isNpf =
      row.kol_level?.is_npf === true ||
      (Number.isFinite(Number(row.kol_level?.level)) &&
        Number(row.kol_level.level) >= 3);
    const current = trendByPeriod.get(row.period_month) || {
      period_month: row.period_month,
      numerator: 0,
      denominator: 0,
      percentage: 0,
    };
    current.denominator += outstanding;
    if (isNpf) current.numerator += outstanding;
    trendByPeriod.set(row.period_month, current);
  }

  const trend = [...trendByPeriod.values()].map((item) => ({
    ...item,
    percentage:
      item.denominator > 0 ? roundPercent(item.numerator / item.denominator) : 0,
  }));

  return {
    formula:
      "total outstanding kontrak aktif Kol 3-5 / total outstanding kontrak aktif",
    numerator,
    denominator,
    percentage: denominator > 0 ? roundPercent(numerator / denominator) : 0,
    breakdown_per_kol: [...breakdownByKol.values()].sort((a, b) => {
      if (a.level === null) return 1;
      if (b.level === null) return -1;
      return a.level - b.level;
    }),
    details,
    trend,
  };
};

exports.getMarketingActivity = async (query = {}) => {
  const fromDate = parseDate(query.from_date);
  const toDate = parseDate(query.to_date, true);
  const [groups, recent] = await Promise.all([
    repository.groupMarketingActivities({ fromDate, toDate }),
    repository.findRecentMarketingActivities({ fromDate, toDate }),
  ]);

  return {
    summary: groups.map((item) => ({
      activity_kind: item.activity_kind,
      status: item.status,
      total: item._count.id,
    })),
    recent_activities: recent.map((item) => ({
      id: item.id,
      activity_kind: item.activity_kind,
      status: item.status,
      activity_date: item.activity_date,
      target_date: item.target_date,
      debtor: item.debtor,
      contract: item.contract,
      notes: item.notes,
      created_at: item.created_at,
    })),
  };
};
