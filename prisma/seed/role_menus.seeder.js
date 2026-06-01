const crypto = require("crypto");
const prisma = require("../../src/config/prisma");
const {
  APPROVE_FEATURE,
  DIVISION_MANAGER_FEATURE,
  HANDOVER_FEATURE,
  MANAGE_ALL_FEATURE,
  REDISPOSE_FEATURE,
  REJECT_FEATURE,
  REPORT_ALL_FEATURE,
  RETURN_FEATURE,
  VIEW_DIVISION_FEATURE,
  getMenuCapabilities,
  getMenuFeatures,
  normalizeFeatures,
} = require("../../src/utils/menu-access");

const SEEDED_ROLES = ["Admin", "Staf", "Supervisor", "Manager"];
const BOOTSTRAP_ROLE = "Admin";
const DASHBOARD_URL = "/dashboard";
const DASHBOARD_WIDGET_MENU_TYPE = "DASHBOARD_WIDGET";
const URLS = {
  dashboard: DASHBOARD_URL,
  storageUsage: "/dashboard/storage-usage",

  archiveInput: "/dashboard/arsip-digital/input-dokumen",
  archiveStorage: "/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan",
  archiveList: "/dashboard/arsip-digital/ruang-arsip/list-dokumen",
  archiveDueDate: "/dashboard/arsip-digital/ruang-arsip/jatuh-tempo",
  archiveAccessRequest: "/dashboard/arsip-digital/disposisi/pengajuan",
  archiveAccessApproval: "/dashboard/arsip-digital/disposisi/permintaan",
  archiveAccessHistory: "/dashboard/arsip-digital/disposisi/historis",
  archiveLoanRequest: "/dashboard/arsip-digital/peminjaman/request",
  archiveLoanApproval: "/dashboard/arsip-digital/peminjaman/accept",
  archiveLoanReport: "/dashboard/arsip-digital/peminjaman/laporan",
  archiveStorageHistory: "/dashboard/arsip-digital/historis/penyimpanan",
  archiveLoanHistory: "/dashboard/arsip-digital/historis/peminjaman",
  archiveReport: "/dashboard/arsip-digital/laporan",

  incomingMail: "/dashboard/manajemen-surat/kelola-surat/input-surat-masuk",
  outgoingMail: "/dashboard/manajemen-surat/kelola-surat/input-surat-keluar",
  memorandum: "/dashboard/manajemen-surat/kelola-surat/input-memorandum",
  correspondenceReport: "/dashboard/manajemen-surat/laporan",
  correspondencePrint: "/dashboard/manajemen-surat/cetak-dokumen",

  debtorReport: "/dashboard/informasi-debitur/laporan",
  debtorList: "/dashboard/informasi-debitur",
  debtorMaster: "/dashboard/informasi-debitur/master-debitur",
  debtorActionPlan: "/dashboard/informasi-debitur/marketing/action-plan",
  debtorVisitResult:
    "/dashboard/informasi-debitur/marketing/hasil-kunjungan",
  debtorHandlingStep:
    "/dashboard/informasi-debitur/marketing/langkah-penanganan",
  debtorUploadSlik: "/dashboard/informasi-debitur/admin/upload-slik",
  debtorImportMonitoring:
    "/dashboard/informasi-debitur/admin/monitoring-import",
  debtorUploadIdeb: "/dashboard/informasi-debitur/admin/upload-ideb",
  debtorUploadRestrik: "/dashboard/informasi-debitur/admin/upload-restrik",
  debtorReportNpf: "/dashboard/informasi-debitur/laporan/npf",
  debtorReportMarketingActivity:
    "/dashboard/informasi-debitur/laporan/aktivitas-marketing",
  legalOverview: "/dashboard/legal",
  legalTemplate: "/dashboard/legal/template-dokumen",
  legalPrintAkad: "/dashboard/legal/cetak/akad",
  legalPrintHaftsheet: "/dashboard/legal/cetak/haftsheet",
  legalPrintWarningLetter: "/dashboard/legal/cetak/surat-peringatan",
  legalPrintCoverLetter: "/dashboard/legal/cetak/surat-pengantar",
  legalPrintSkl: "/dashboard/legal/cetak/keterangan-lunas",
  legalPrintSamsat: "/dashboard/legal/cetak/surat-samsat",
  legalPrintOther: "/dashboard/legal/cetak/dokumen-lainnya",
  legalDepositInsurance: "/dashboard/legal/titipan/asuransi",
  legalDepositNotary: "/dashboard/legal/titipan/notaris",
  legalDepositInstallment: "/dashboard/legal/titipan/angsuran",
  legalProgressNotary: "/dashboard/legal/progress/notaris",
  legalProgressInsurance: "/dashboard/legal/progress/asuransi",
  legalProgressKjpp: "/dashboard/legal/progress/kjpp",
  legalProgressClaim: "/dashboard/legal/progress/klaim",
  legalReport: "/dashboard/legal/laporan",
  legalReportThirdPartyDocuments:
    "/dashboard/legal/laporan/pihak-ketiga/dokumen",
  legalReportThirdPartyDepositFunds:
    "/dashboard/legal/laporan/pihak-ketiga/dana-titipan",

  users: "/dashboard/users",
  role: "/dashboard/parameter/role",
  roleMenu: "/dashboard/parameter/role-menu",
  division: "/dashboard/parameter/divisi",
  documentType: "/dashboard/parameter/jenis-dokumen",
  storage: "/dashboard/parameter/tempat-penyimpanan",
  letterPriority: "/dashboard/parameter/prioritas-surat",
  mailDeliveryMedia: "/dashboard/parameter/media-pengiriman-surat",
  thirdPartyNotary: "/dashboard/parameter/pihak-ketiga/notaris",
  thirdPartyInsurance:
    "/dashboard/parameter/pihak-ketiga/perusahaan-asuransi",
  thirdPartyKjpp: "/dashboard/parameter/pihak-ketiga/kjpp",
  numberingTemplate: "/dashboard/parameter/template-penomoran",
  documentChecklist: "/dashboard/parameter/checklist-dokumen",
  financingProduct: "/dashboard/parameter/produk-pembiayaan",
  contractType: "/dashboard/parameter/jenis-akad",
  collectibility: "/dashboard/parameter/kolektibilitas",
  branch: "/dashboard/parameter/cabang",
  collateralType: "/dashboard/parameter/jenis-agunan",
  restructuringType: "/dashboard/parameter/jenis-restrukturisasi",
  depositType: "/dashboard/parameter/jenis-titipan",
  watermarkSettings: "/dashboard/parameter/watermark-dokumen",
  legalProcessType: "/dashboard/parameter/jenis-proses-legal",
};
const CORE_PARAMETER_URLS = [
  URLS.users,
  URLS.role,
  URLS.roleMenu,
  URLS.division,
  URLS.documentType,
  URLS.storage,
  URLS.letterPriority,
  URLS.mailDeliveryMedia,
];
const EXTENDED_PARAMETER_URLS = [
  URLS.thirdPartyNotary,
  URLS.thirdPartyInsurance,
  URLS.thirdPartyKjpp,
  URLS.numberingTemplate,
  URLS.documentChecklist,
  URLS.financingProduct,
  URLS.contractType,
  URLS.collectibility,
  URLS.branch,
  URLS.collateralType,
  URLS.restructuringType,
  URLS.depositType,
  URLS.legalProcessType,
];
const DEBTOR_CRUD_URLS = [
  URLS.debtorMaster,
  URLS.debtorActionPlan,
  URLS.debtorVisitResult,
  URLS.debtorHandlingStep,
];
const DEBTOR_IMPORT_URLS = [
  URLS.debtorUploadSlik,
  URLS.debtorUploadIdeb,
  URLS.debtorUploadRestrik,
];
const DEBTOR_REPORT_URLS = [
  URLS.debtorReport,
  URLS.debtorReportNpf,
  URLS.debtorReportMarketingActivity,
];
const LEGAL_CRUD_URLS = [
  URLS.legalTemplate,
  URLS.legalDepositInsurance,
  URLS.legalDepositNotary,
  URLS.legalDepositInstallment,
  URLS.legalProgressNotary,
  URLS.legalProgressInsurance,
  URLS.legalProgressKjpp,
  URLS.legalProgressClaim,
];
const LEGAL_PRINT_URLS = [
  URLS.legalPrintAkad,
  URLS.legalPrintHaftsheet,
  URLS.legalPrintWarningLetter,
  URLS.legalPrintCoverLetter,
  URLS.legalPrintSkl,
  URLS.legalPrintSamsat,
  URLS.legalPrintOther,
];
const LEGAL_REPORT_URLS = [
  URLS.legalOverview,
  URLS.legalReport,
  URLS.legalReportThirdPartyDocuments,
  URLS.legalReportThirdPartyDepositFunds,
];
const DASHBOARD_REPORT_WIDGET_URLS = [
  URLS.archiveReport,
  URLS.correspondenceReport,
  URLS.debtorReport,
  URLS.legalReport,
  URLS.legalReportThirdPartyDocuments,
  URLS.legalReportThirdPartyDepositFunds,
  URLS.debtorReportNpf,
  URLS.debtorReportMarketingActivity,
];
const ARCHIVE_MONITOR_URLS = [
  URLS.archiveInput,
  URLS.archiveStorage,
  URLS.archiveList,
  URLS.archiveDueDate,
  URLS.archiveAccessRequest,
  URLS.archiveAccessApproval,
  URLS.archiveAccessHistory,
  URLS.archiveLoanRequest,
  URLS.archiveLoanApproval,
  URLS.archiveLoanReport,
  URLS.archiveStorageHistory,
  URLS.archiveLoanHistory,
  URLS.archiveReport,
];
const CORRESPONDENCE_MONITOR_URLS = [
  URLS.incomingMail,
  URLS.outgoingMail,
  URLS.memorandum,
  URLS.correspondenceReport,
  URLS.correspondencePrint,
];
const DISABLED_MENU_ROOT_NAMES = [];
const DISABLED_MENU_BRANCHES = [];
const DISABLED_MENU_URLS = [];
const ROLE_MENU_POLICIES = {
  Admin: [
    { url: URLS.dashboard, permissions: ["read"] },
    { url: URLS.storageUsage, permissions: ["read"] },

    ...CORE_PARAMETER_URLS.map((url) => ({
      url,
      permissions: ["create", "read", "update", "delete"],
    })),
    ...EXTENDED_PARAMETER_URLS.map((url) => ({
      url,
      permissions: ["create", "read", "update", "delete"],
    })),

    { url: URLS.watermarkSettings, permissions: ["read", "update"] },

    ...ARCHIVE_MONITOR_URLS.map((url) => ({
      url,
      permissions: ["read"],
      features: [REPORT_ALL_FEATURE],
    })),
    {
      url: URLS.archiveInput,
      permissions: ["create", "read"],
      features: [MANAGE_ALL_FEATURE],
    },
    {
      url: URLS.archiveList,
      permissions: ["create", "read", "update", "delete"],
      features: [MANAGE_ALL_FEATURE],
    },
    { url: URLS.archiveAccessRequest, permissions: ["create", "read"] },
    {
      url: URLS.archiveAccessApproval,
      permissions: ["read", "update"],
      features: [APPROVE_FEATURE, REJECT_FEATURE],
    },
    { url: URLS.archiveLoanRequest, permissions: ["create", "read"] },
    {
      url: URLS.archiveLoanApproval,
      permissions: ["read", "update"],
      features: [
        APPROVE_FEATURE,
        REJECT_FEATURE,
        HANDOVER_FEATURE,
        RETURN_FEATURE,
      ],
    },

    ...CORRESPONDENCE_MONITOR_URLS.map((url) => ({
      url,
      permissions: ["read"],
      features: [REPORT_ALL_FEATURE, VIEW_DIVISION_FEATURE, MANAGE_ALL_FEATURE],
    })),
    {
      url: URLS.incomingMail,
      permissions: ["create", "read", "update", "delete"],
      features: [
        MANAGE_ALL_FEATURE,
        DIVISION_MANAGER_FEATURE,
        REDISPOSE_FEATURE,
      ],
    },
    {
      url: URLS.outgoingMail,
      permissions: ["create", "read", "update", "delete"],
      features: [MANAGE_ALL_FEATURE],
    },
    {
      url: URLS.memorandum,
      permissions: ["create", "read", "update", "delete"],
      features: [
        MANAGE_ALL_FEATURE,
        DIVISION_MANAGER_FEATURE,
        REDISPOSE_FEATURE,
      ],
    },

    {
      url: URLS.debtorList,
      permissions: ["read"],
      features: [MANAGE_ALL_FEATURE],
    },
    ...DEBTOR_CRUD_URLS.map((url) => ({
      url,
      permissions: ["create", "read", "update", "delete"],
      features: [MANAGE_ALL_FEATURE],
    })),
    ...DEBTOR_IMPORT_URLS.map((url) => ({
      url,
      permissions: ["create", "read"],
      features: [MANAGE_ALL_FEATURE],
    })),
    {
      url: URLS.debtorImportMonitoring,
      permissions: ["read"],
      features: [MANAGE_ALL_FEATURE],
    },
    ...DEBTOR_REPORT_URLS.map((url) => ({
      url,
      permissions: ["read"],
      features: [REPORT_ALL_FEATURE],
    })),

    ...LEGAL_CRUD_URLS.map((url) => ({
      url,
      permissions: ["create", "read", "update", "delete"],
      features: [MANAGE_ALL_FEATURE],
    })),
    ...LEGAL_PRINT_URLS.map((url) => ({
      url,
      permissions: ["create", "read"],
      features: [MANAGE_ALL_FEATURE],
    })),
    ...LEGAL_REPORT_URLS.map((url) => ({
      url,
      permissions: ["read"],
      features: [REPORT_ALL_FEATURE],
    })),

    ...DASHBOARD_REPORT_WIDGET_URLS.map((url) => ({
      url,
      permissions: ["read"],
      features: [REPORT_ALL_FEATURE],
    })),
  ],
  Manager: [
    { url: URLS.dashboard, permissions: ["read"] },
    { url: URLS.storageUsage, permissions: ["read"] },

    {
      url: URLS.archiveStorage,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveList,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveDueDate,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveAccessApproval,
      permissions: ["read", "update"],
      features: [VIEW_DIVISION_FEATURE, APPROVE_FEATURE, REJECT_FEATURE],
    },
    {
      url: URLS.archiveLoanApproval,
      permissions: ["read", "update"],
      features: [
        VIEW_DIVISION_FEATURE,
        APPROVE_FEATURE,
        REJECT_FEATURE,
        HANDOVER_FEATURE,
        RETURN_FEATURE,
      ],
    },
    {
      url: URLS.archiveAccessHistory,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveLoanReport,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveStorageHistory,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveLoanHistory,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveReport,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },

    {
      url: URLS.incomingMail,
      permissions: ["read", "update"],
      features: [
        VIEW_DIVISION_FEATURE,
        DIVISION_MANAGER_FEATURE,
        REDISPOSE_FEATURE,
      ],
    },
    {
      url: URLS.outgoingMail,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.memorandum,
      permissions: ["read", "update"],
      features: [
        VIEW_DIVISION_FEATURE,
        DIVISION_MANAGER_FEATURE,
        REDISPOSE_FEATURE,
      ],
    },
    {
      url: URLS.correspondenceReport,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.correspondencePrint,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },

    {
      url: URLS.debtorList,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    ...DEBTOR_CRUD_URLS.map((url) => ({
      url,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    })),
    ...DEBTOR_REPORT_URLS.map((url) => ({
      url,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    })),

    ...LEGAL_CRUD_URLS.map((url) => ({
      url,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    })),
    ...LEGAL_PRINT_URLS.map((url) => ({
      url,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    })),
    ...LEGAL_REPORT_URLS.map((url) => ({
      url,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    })),

    ...DASHBOARD_REPORT_WIDGET_URLS.map((url) => ({
      url,
      permissions: ["read"],
    })),
  ],
  Supervisor: [
    { url: URLS.dashboard, permissions: ["read"] },

    {
      url: URLS.archiveInput,
      permissions: ["create", "read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveStorage,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveList,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveDueDate,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveAccessApproval,
      permissions: ["read", "update"],
      features: [VIEW_DIVISION_FEATURE, APPROVE_FEATURE, REJECT_FEATURE],
    },
    {
      url: URLS.archiveAccessHistory,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveLoanApproval,
      permissions: ["read", "update"],
      features: [
        VIEW_DIVISION_FEATURE,
        APPROVE_FEATURE,
        REJECT_FEATURE,
        HANDOVER_FEATURE,
        RETURN_FEATURE,
      ],
    },
    {
      url: URLS.archiveLoanReport,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveStorageHistory,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveLoanHistory,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.archiveReport,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },

    {
      url: URLS.incomingMail,
      permissions: ["read", "update"],
      features: [VIEW_DIVISION_FEATURE, REDISPOSE_FEATURE],
    },
    {
      url: URLS.outgoingMail,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.memorandum,
      permissions: ["read", "update"],
      features: [VIEW_DIVISION_FEATURE, REDISPOSE_FEATURE],
    },
    {
      url: URLS.correspondenceReport,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    {
      url: URLS.correspondencePrint,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },

    {
      url: URLS.debtorList,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    },
    ...DEBTOR_CRUD_URLS.map((url) => ({
      url,
      permissions: ["create", "read", "update"],
      features: [VIEW_DIVISION_FEATURE],
    })),
    ...DEBTOR_REPORT_URLS.map((url) => ({
      url,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    })),

    {
      url: URLS.legalTemplate,
      permissions: ["read"],
    },
    ...LEGAL_CRUD_URLS.filter((url) => url !== URLS.legalTemplate).map((url) => ({
      url,
      permissions: ["create", "read", "update"],
      features: [VIEW_DIVISION_FEATURE],
    })),
    ...LEGAL_PRINT_URLS.map((url) => ({
      url,
      permissions: ["create", "read"],
      features: [VIEW_DIVISION_FEATURE],
    })),
    ...LEGAL_REPORT_URLS.map((url) => ({
      url,
      permissions: ["read"],
      features: [VIEW_DIVISION_FEATURE],
    })),

    ...DASHBOARD_REPORT_WIDGET_URLS.map((url) => ({
      url,
      permissions: ["read"],
    })),
  ],
  Staf: [
    { url: URLS.dashboard, permissions: ["read"] },

    { url: URLS.archiveInput, permissions: ["create", "read"] },
    { url: URLS.archiveStorage, permissions: ["read"] },
    { url: URLS.archiveList, permissions: ["read", "update"] },
    { url: URLS.archiveDueDate, permissions: ["read"] },
    { url: URLS.archiveAccessRequest, permissions: ["create", "read"] },
    { url: URLS.archiveAccessApproval, permissions: ["read", "update"] },
    { url: URLS.archiveAccessHistory, permissions: ["read"] },
    { url: URLS.archiveLoanRequest, permissions: ["create", "read"] },
    { url: URLS.archiveLoanReport, permissions: ["read"] },
    { url: URLS.archiveStorageHistory, permissions: ["read"] },
    { url: URLS.archiveLoanHistory, permissions: ["read"] },
    { url: URLS.archiveReport, permissions: ["read"] },

    {
      url: URLS.incomingMail,
      permissions: ["create", "read", "update"],
    },
    { url: URLS.outgoingMail, permissions: ["create", "read", "update"] },
    {
      url: URLS.memorandum,
      permissions: ["create", "read", "update"],
    },
    { url: URLS.correspondenceReport, permissions: ["read"] },
    { url: URLS.correspondencePrint, permissions: ["read"] },

    { url: URLS.debtorList, permissions: ["read"] },
    ...DEBTOR_CRUD_URLS.map((url) => ({
      url,
      permissions: ["create", "read", "update"],
    })),
    ...DEBTOR_REPORT_URLS.map((url) => ({
      url,
      permissions: ["read"],
    })),

    { url: URLS.legalTemplate, permissions: ["read"] },
    ...LEGAL_CRUD_URLS.filter((url) => url !== URLS.legalTemplate).map((url) => ({
      url,
      permissions: ["create", "read", "update"],
    })),
    ...LEGAL_PRINT_URLS.map((url) => ({
      url,
      permissions: ["create", "read"],
    })),
    ...LEGAL_REPORT_URLS.map((url) => ({
      url,
      permissions: ["read"],
    })),
  ],
};

function buildPermission({ permissions = ["read"], features = [], url } = {}) {
  const permissionSet = new Set(permissions);
  const allowedCapabilities = new Set(getMenuCapabilities(url));
  const allowedFeatures = new Set(getMenuFeatures(url));

  return {
    can_create: permissionSet.has("create") && allowedCapabilities.has("create"),
    can_read: permissionSet.has("read") && allowedCapabilities.has("read"),
    can_update: permissionSet.has("update") && allowedCapabilities.has("update"),
    can_delete: permissionSet.has("delete") && allowedCapabilities.has("delete"),
    features: normalizeFeatures(features).filter((feature) =>
      allowedFeatures.has(feature),
    ),
  };
}

function mergePermissions(current, next) {
  return {
    can_create: Boolean(current?.can_create || next.can_create),
    can_read: Boolean(current?.can_read || next.can_read),
    can_update: Boolean(current?.can_update || next.can_update),
    can_delete: Boolean(current?.can_delete || next.can_delete),
    features: normalizeFeatures([...(current?.features || []), ...(next.features || [])]),
  };
}

function addPermission(store, menuId, roleId, permissionValue) {
  const key = `${roleId}:${menuId}`;
  store.set(key, {
    role_id: roleId,
    menu_id: menuId,
    ...mergePermissions(store.get(key), permissionValue),
  });
}

function addParentReadPermissions(store, menu, menusById, roleId) {
  let parentId = menu.parent_id;

  while (parentId) {
    const parent = menusById.get(parentId);
    if (!parent) return;

    addPermission(store, parent.id, roleId, readPermission());
    parentId = parent.parent_id;
  }
}

function readPermission() {
  return buildPermission({ permissions: ["read"] });
}

function isDashboardWidgetMenu(menu) {
  return menu?.menu_type === DASHBOARD_WIDGET_MENU_TYPE;
}

function collectDescendantMenuIds(
  menu,
  menusByParentId,
  store,
  { skipDashboardWidgets = false } = {},
) {
  if (!(skipDashboardWidgets && isDashboardWidgetMenu(menu))) {
    store.add(menu.id);
  }

  for (const child of menusByParentId.get(menu.id) || []) {
    collectDescendantMenuIds(child, menusByParentId, store, {
      skipDashboardWidgets,
    });
  }
}

async function seedRoleMenus() {
  console.log("Seeding role menus...");

  const menus = await prisma.menus.findMany();
  const roles = await prisma.roles.findMany({
    where: {
      name: {
        in: SEEDED_ROLES,
      },
    },
  });

  const rolesByName = new Map(roles.map((role) => [role.name, role]));
  const bootstrapRole = rolesByName.get(BOOTSTRAP_ROLE);

  if (!bootstrapRole) {
    throw new Error(`Role seed tidak lengkap: ${BOOTSTRAP_ROLE} tidak ditemukan.`);
  }

  for (const roleName of SEEDED_ROLES) {
    if (!rolesByName.has(roleName)) {
      throw new Error(`Role seed tidak lengkap: ${roleName} tidak ditemukan.`);
    }
  }

  const menusByUrl = new Map(
    menus.filter((menu) => menu.url).map((menu) => [menu.url, menu]),
  );
  const menusById = new Map(menus.map((menu) => [menu.id, menu]));
  const menusByParentId = new Map();

  for (const menu of menus) {
    const parentId = menu.parent_id || null;
    if (!menusByParentId.has(parentId)) {
      menusByParentId.set(parentId, []);
    }
    menusByParentId.get(parentId).push(menu);
  }

  const disabledMenuIds = new Set();
  for (const menu of menus) {
    if (!menu.parent_id && DISABLED_MENU_ROOT_NAMES.includes(menu.name)) {
      collectDescendantMenuIds(menu, menusByParentId, disabledMenuIds, {
        skipDashboardWidgets: true,
      });
    }
  }

  for (const branch of DISABLED_MENU_BRANCHES) {
    const menu = menus.find(
      (item) =>
        item.name === branch.name && item.parent_label === branch.parentLabel,
    );

    if (menu) {
      collectDescendantMenuIds(menu, menusByParentId, disabledMenuIds);
    }
  }

  for (const url of DISABLED_MENU_URLS) {
    const menu = menusByUrl.get(url);
    if (menu) {
      collectDescendantMenuIds(menu, menusByParentId, disabledMenuIds);
    }
  }

  const roleMenusByKey = new Map();

  for (const [roleName, policies] of Object.entries(ROLE_MENU_POLICIES)) {
    const role = rolesByName.get(roleName);

    for (const policy of policies) {
      const menu = menusByUrl.get(policy.url);
      if (!menu) {
        throw new Error(`Menu seed tidak lengkap: ${policy.url} tidak ditemukan.`);
      }

      if (disabledMenuIds.has(menu.id)) {
        continue;
      }

      addPermission(
        roleMenusByKey,
        menu.id,
        role.id,
        buildPermission(policy),
      );
      addParentReadPermissions(roleMenusByKey, menu, menusById, role.id);
    }
  }

  const expectedRoleMenus = Array.from(roleMenusByKey.values());
  const managedRoleIds = roles.map((role) => role.id);

  const existingRoleMenus = await prisma.role_menus.findMany({
    where: {
      role_id: {
        in: managedRoleIds,
      },
    },
    select: {
      id: true,
      role_id: true,
      menu_id: true,
    },
  });

  const existingKeys = new Set(
    existingRoleMenus.map((item) => `${item.role_id}:${item.menu_id}`),
  );
  const missingInitialRoleMenus = expectedRoleMenus.filter(
    (roleMenu) => !existingKeys.has(`${roleMenu.role_id}:${roleMenu.menu_id}`),
  );

  if (missingInitialRoleMenus.length > 0) {
    await prisma.role_menus.createMany({
      data: missingInitialRoleMenus.map((roleMenu) => ({
        id: crypto.randomUUID(),
        ...roleMenu,
      })),
      skipDuplicates: true,
    });
  }

  console.log(
    `Role menus seeded! ${missingInitialRoleMenus.length} initial permission(s) created; existing role-menu settings preserved.`,
  );
}

module.exports = {
  ROLE_MENU_POLICIES,
  SEEDED_ROLES,
  buildPermission,
  seedRoleMenus,
};
