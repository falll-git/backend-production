const repository = require("./debtorReports.repository");
const {
  buildContractVisibilityWhere,
  buildDebtorVisibilityWhere,
  getDebtorAccessScope,
} = require("../../utils/debtor-access");
const { REPORT_ALL_FEATURE } = require("../../utils/menu-access");
const { roleHasFeature } = require("../../utils/rbac");
const { serializeFile } = require("../../utils/domain-files");

const REPORT_URLS = {
  summary: "/dashboard/informasi-debitur/laporan",
  npf: "/dashboard/informasi-debitur/laporan/npf",
  marketingActivity: "/dashboard/informasi-debitur/laporan/aktivitas-marketing",
};

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

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized || null;
}

function normalizeMarketingKind(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "ACTION_PLAN") return "ACTION_PLAN";
  if (normalized === "VISIT_RESULT" || normalized === "HASIL_KUNJUNGAN") {
    return "VISIT_RESULT";
  }
  if (normalized === "HANDLING_STEP" || normalized === "LANGKAH_PENANGANAN") {
    return "HANDLING_STEP";
  }
  return null;
}

function normalizeMarketingSort(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ["OLDEST", "TERLAMA", "ASC"].includes(normalized) ? "oldest" : "newest";
}

function normalizeLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 50;
  return Math.min(Math.max(Math.trunc(numeric), 1), 100);
}

function serializeMarketingReportActivity(req, item) {
  return {
    id: item.id,
    activity_kind: item.activity_kind,
    status: item.status,
    activity_date: item.activity_date,
    target_date: item.target_date,
    debtor: item.debtor,
    contract: item.contract,
    action_plan: item.action_plan,
    visit_address: item.visit_address,
    visit_result: item.visit_result,
    conclusion: item.conclusion,
    handling_step: item.handling_step,
    handling_result: item.handling_result,
    notes: item.notes,
    file: serializeFile(req, item, {
      module: "debtor_information",
      entityId: item.id,
      fallbackBaseName: item.activity_kind,
    }),
    created_at: item.created_at,
  };
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

async function getReportScope(userId, menuUrl) {
  const scope = await getDebtorAccessScope(userId);
  const canReportAll = await roleHasFeature(
    scope.roleId,
    menuUrl,
    REPORT_ALL_FEATURE,
  );

  return {
    ...scope,
    operationalCanManageAll: scope.canManageAll,
    canViewAll: Boolean(canReportAll),
    canManageAll: false,
    canReportAll,
  };
}

exports.getSummary = async (_query = {}, userId = null) => {
  const scope = await getReportScope(userId, REPORT_URLS.summary);
  const debtorWhere = buildDebtorVisibilityWhere(scope);
  const contractWhere = buildContractVisibilityWhere(scope);
  const [totalDebtors, activeDebtors, activeContracts, closedContracts] =
    await Promise.all([
      repository.countDebtors({ deleted_at: null, ...debtorWhere }),
      repository.countDebtors({ deleted_at: null, status: "ACTIVE", ...debtorWhere }),
      repository.countContracts({
        deleted_at: null,
        status: { in: ["ACTIVE", "AKTIF", "BERJALAN"] },
        ...contractWhere,
      }),
      repository.countContracts({
        deleted_at: null,
        status: { in: ["CLOSED", "LUNAS", "SELESAI"] },
        ...contractWhere,
      }),
    ]);

  return {
    total_debtors: totalDebtors,
    active_debtors: activeDebtors,
    inactive_debtors: Math.max(totalDebtors - activeDebtors, 0),
    active_contracts: activeContracts,
    closed_contracts: closedContracts,
    scope: {
      can_report_all: scope.canReportAll,
      can_view_division: scope.canViewDivision,
      can_manage_all: scope.operationalCanManageAll,
    },
  };
};

exports.getNpf = async (query = {}, userId = null) => {
  const scope = await getReportScope(userId, REPORT_URLS.npf);
  const contractWhere = buildContractVisibilityWhere(scope);
  const [contracts, trendRows] = await Promise.all([
    repository.findContractsForNpf(contractWhere),
    repository.findCollectibilityTrendRows({
      from: query.from_period,
      to: query.to_period,
      contractWhere,
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
    scope: {
      can_report_all: scope.canReportAll,
      can_view_division: scope.canViewDivision,
      can_manage_all: scope.operationalCanManageAll,
    },
  };
};

exports.getMarketingActivity = async (req, query = {}, userId = null) => {
  const fromDate = parseDate(query.from_date);
  const toDate = parseDate(query.to_date, true);
  const activityKind = normalizeMarketingKind(query.activity_kind);
  const status = normalizeText(query.status)?.toUpperCase() || null;
  const search = normalizeText(query.search);
  const sort = normalizeMarketingSort(query.sort);
  const limit = normalizeLimit(query.limit);
  const scope = await getReportScope(userId, REPORT_URLS.marketingActivity);
  const debtorWhere = buildDebtorVisibilityWhere(scope);
  const reportParams = {
    fromDate,
    toDate,
    debtorWhere,
    activityKind,
    status,
    search,
    sort,
    limit,
  };
  const [groups, recent] = await Promise.all([
    repository.groupMarketingActivities(reportParams),
    repository.findRecentMarketingActivities(reportParams),
  ]);

  return {
    summary: groups.map((item) => ({
      activity_kind: item.activity_kind,
      status: item.status,
      total: item._count.id,
    })),
    recent_activities: recent.map((item) =>
      serializeMarketingReportActivity(req, item),
    ),
    scope: {
      can_report_all: scope.canReportAll,
      can_view_division: scope.canViewDivision,
      can_manage_all: scope.operationalCanManageAll,
    },
  };
};
