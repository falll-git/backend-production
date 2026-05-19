const { AppError } = require("./errors");

const PERMISSION_FIELDS = [
  "can_create",
  "can_read",
  "can_update",
  "can_delete",
];

const CAPABILITY_FIELDS = {
  create: "can_create",
  read: "can_read",
  update: "can_update",
  delete: "can_delete",
};

const FIELD_CAPABILITIES = Object.fromEntries(
  Object.entries(CAPABILITY_FIELDS).map(([capability, field]) => [
    field,
    capability,
  ]),
);

const READ_ONLY = ["read"];
const CRUD = ["create", "read", "update", "delete"];
const READ_CREATE = ["create", "read"];
const READ_UPDATE = ["read", "update"];
const READ_CREATE_UPDATE_DELETE = CRUD;
const REPORT_ALL_FEATURE = "report_all";
const VIEW_DIVISION_FEATURE = "view_division";
const MANAGE_ALL_FEATURE = "manage_all";
const DIVISION_MANAGER_FEATURE = "division_manager";
const REDISPOSE_FEATURE = "redispose";
const APPROVE_FEATURE = "approve";
const REJECT_FEATURE = "reject";
const HANDOVER_FEATURE = "handover";
const RETURN_FEATURE = "return";

const FEATURE_LABELS = {
  [REPORT_ALL_FEATURE]: "Semua Data",
  [VIEW_DIVISION_FEATURE]: "Data Divisi",
  [MANAGE_ALL_FEATURE]: "Kelola Semua Data",
  [DIVISION_MANAGER_FEATURE]: "Penerima Disposisi Divisi",
  [REDISPOSE_FEATURE]: "Redisposisi",
  [APPROVE_FEATURE]: "Setujui",
  [REJECT_FEATURE]: "Tolak",
  [HANDOVER_FEATURE]: "Serahkan",
  [RETURN_FEATURE]: "Kembalikan",
};

const MENU_CAPABILITIES = {
  "/dashboard": READ_ONLY,
  "/dashboard/storage-usage": READ_ONLY,

  "/dashboard/arsip-digital/input-dokumen": READ_CREATE,
  "/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan": READ_ONLY,
  "/dashboard/arsip-digital/ruang-arsip/list-dokumen": CRUD,
  "/dashboard/arsip-digital/ruang-arsip/jatuh-tempo": READ_ONLY,
  "/dashboard/arsip-digital/disposisi/pengajuan": READ_CREATE,
  "/dashboard/arsip-digital/disposisi/permintaan": READ_UPDATE,
  "/dashboard/arsip-digital/disposisi/historis": READ_ONLY,
  "/dashboard/arsip-digital/peminjaman/request": READ_CREATE,
  "/dashboard/arsip-digital/peminjaman/accept": READ_UPDATE,
  "/dashboard/arsip-digital/peminjaman/laporan": READ_ONLY,
  "/dashboard/arsip-digital/historis/penyimpanan": READ_ONLY,
  "/dashboard/arsip-digital/historis/peminjaman": READ_ONLY,
  "/dashboard/arsip-digital/laporan": READ_ONLY,

  "/dashboard/manajemen-surat/kelola-surat/input-surat-masuk": CRUD,
  "/dashboard/manajemen-surat/kelola-surat/input-surat-keluar": CRUD,
  "/dashboard/manajemen-surat/kelola-surat/input-memorandum": CRUD,
  "/dashboard/manajemen-surat/laporan": READ_ONLY,
  "/dashboard/manajemen-surat/cetak-dokumen": READ_ONLY,

  "/dashboard/informasi-debitur": READ_ONLY,
  "/dashboard/informasi-debitur/master-debitur": CRUD,
  "/dashboard/informasi-debitur/marketing/action-plan": CRUD,
  "/dashboard/informasi-debitur/marketing/hasil-kunjungan": CRUD,
  "/dashboard/informasi-debitur/marketing/langkah-penanganan": CRUD,
  "/dashboard/informasi-debitur/admin/upload-slik": READ_CREATE,
  "/dashboard/informasi-debitur/admin/upload-restrik": READ_CREATE,
  "/dashboard/informasi-debitur/admin/import-debitur": READ_CREATE,
  "/dashboard/informasi-debitur/admin/import-kolektibilitas": READ_CREATE,
  "/dashboard/informasi-debitur/laporan": READ_ONLY,
  "/dashboard/informasi-debitur/laporan/npf": READ_ONLY,
  "/dashboard/informasi-debitur/laporan/aktivitas-marketing": READ_ONLY,

  "/dashboard/legal": READ_ONLY,
  "/dashboard/legal/template-dokumen": CRUD,
  "/dashboard/legal/cetak/akad": READ_CREATE,
  "/dashboard/legal/cetak/haftsheet": READ_CREATE,
  "/dashboard/legal/cetak/surat-peringatan": READ_CREATE,
  "/dashboard/legal/cetak/formulir-asuransi": READ_CREATE,
  "/dashboard/legal/cetak/keterangan-lunas": READ_CREATE,
  "/dashboard/legal/cetak/surat-samsat": READ_CREATE,
  "/dashboard/legal/titipan/asuransi": CRUD,
  "/dashboard/legal/titipan/notaris": CRUD,
  "/dashboard/legal/titipan/angsuran": CRUD,
  "/dashboard/legal/progress/notaris": CRUD,
  "/dashboard/legal/progress/asuransi": CRUD,
  "/dashboard/legal/progress/kjpp": CRUD,
  "/dashboard/legal/progress/klaim": CRUD,
  "/dashboard/legal/upload-ideb": CRUD,
  "/dashboard/legal/laporan/pihak-ketiga/dokumen": READ_ONLY,
  "/dashboard/legal/laporan/pihak-ketiga/dana-titipan": READ_ONLY,
  "/dashboard/legal/laporan": READ_ONLY,

  "/dashboard/users": CRUD,
  "/dashboard/parameter/role": CRUD,
  "/dashboard/parameter/role-menu": CRUD,
  "/dashboard/parameter/divisi": CRUD,
  "/dashboard/parameter/jenis-dokumen": CRUD,
  "/dashboard/parameter/tempat-penyimpanan": CRUD,
  "/dashboard/parameter/prioritas-surat": CRUD,
  "/dashboard/parameter/pihak-ketiga/notaris": CRUD,
  "/dashboard/parameter/pihak-ketiga/perusahaan-asuransi": CRUD,
  "/dashboard/parameter/pihak-ketiga/kjpp": CRUD,
  "/dashboard/parameter/template-penomoran": CRUD,
  "/dashboard/parameter/checklist-dokumen": CRUD,
  "/dashboard/parameter/produk-pembiayaan": CRUD,
  "/dashboard/parameter/jenis-akad": CRUD,
  "/dashboard/parameter/kolektibilitas": CRUD,
  "/dashboard/parameter/cabang": CRUD,
  "/dashboard/parameter/jenis-titipan": CRUD,
  "/dashboard/parameter/watermark-dokumen": READ_UPDATE,
};

const MENU_FEATURES = {
  "/dashboard/arsip-digital/input-dokumen": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
    MANAGE_ALL_FEATURE,
  ],
  "/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
  ],
  "/dashboard/arsip-digital/ruang-arsip/list-dokumen": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
    MANAGE_ALL_FEATURE,
  ],
  "/dashboard/arsip-digital/ruang-arsip/jatuh-tempo": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
  ],
  "/dashboard/arsip-digital/disposisi/pengajuan": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
  ],
  "/dashboard/arsip-digital/disposisi/permintaan": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
    APPROVE_FEATURE,
    REJECT_FEATURE,
  ],
  "/dashboard/arsip-digital/disposisi/historis": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
  ],
  "/dashboard/arsip-digital/peminjaman/request": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
  ],
  "/dashboard/arsip-digital/peminjaman/accept": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
    APPROVE_FEATURE,
    REJECT_FEATURE,
    HANDOVER_FEATURE,
    RETURN_FEATURE,
  ],
  "/dashboard/arsip-digital/peminjaman/laporan": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
  ],
  "/dashboard/arsip-digital/historis/penyimpanan": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
  ],
  "/dashboard/arsip-digital/historis/peminjaman": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
  ],
  "/dashboard/manajemen-surat/laporan": [REPORT_ALL_FEATURE],
  "/dashboard/manajemen-surat/cetak-dokumen": [REPORT_ALL_FEATURE],
  "/dashboard/manajemen-surat/kelola-surat/input-surat-masuk": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
    MANAGE_ALL_FEATURE,
    DIVISION_MANAGER_FEATURE,
    REDISPOSE_FEATURE,
  ],
  "/dashboard/manajemen-surat/kelola-surat/input-surat-keluar": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
    MANAGE_ALL_FEATURE,
  ],
  "/dashboard/manajemen-surat/kelola-surat/input-memorandum": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
    MANAGE_ALL_FEATURE,
    DIVISION_MANAGER_FEATURE,
    REDISPOSE_FEATURE,
  ],
  "/dashboard/arsip-digital/laporan": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
  ],
  "/dashboard/informasi-debitur/laporan": [REPORT_ALL_FEATURE],
  "/dashboard/informasi-debitur": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
    MANAGE_ALL_FEATURE,
  ],
  "/dashboard/informasi-debitur/master-debitur": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
    MANAGE_ALL_FEATURE,
  ],
  "/dashboard/informasi-debitur/marketing/action-plan": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
    MANAGE_ALL_FEATURE,
  ],
  "/dashboard/informasi-debitur/marketing/hasil-kunjungan": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
    MANAGE_ALL_FEATURE,
  ],
  "/dashboard/informasi-debitur/marketing/langkah-penanganan": [
    REPORT_ALL_FEATURE,
    VIEW_DIVISION_FEATURE,
    MANAGE_ALL_FEATURE,
  ],
  "/dashboard/informasi-debitur/admin/upload-slik": [REPORT_ALL_FEATURE],
  "/dashboard/informasi-debitur/admin/upload-restrik": [REPORT_ALL_FEATURE],
  "/dashboard/informasi-debitur/admin/import-debitur": [REPORT_ALL_FEATURE],
  "/dashboard/informasi-debitur/admin/import-kolektibilitas": [
    REPORT_ALL_FEATURE,
  ],
  "/dashboard/informasi-debitur/laporan/npf": [REPORT_ALL_FEATURE],
  "/dashboard/informasi-debitur/laporan/aktivitas-marketing": [
    REPORT_ALL_FEATURE,
  ],
  "/dashboard/legal": [REPORT_ALL_FEATURE],
  "/dashboard/legal/template-dokumen": [REPORT_ALL_FEATURE, MANAGE_ALL_FEATURE],
  "/dashboard/legal/cetak/akad": [REPORT_ALL_FEATURE],
  "/dashboard/legal/cetak/haftsheet": [REPORT_ALL_FEATURE],
  "/dashboard/legal/cetak/surat-peringatan": [REPORT_ALL_FEATURE],
  "/dashboard/legal/cetak/formulir-asuransi": [REPORT_ALL_FEATURE],
  "/dashboard/legal/cetak/keterangan-lunas": [REPORT_ALL_FEATURE],
  "/dashboard/legal/cetak/surat-samsat": [REPORT_ALL_FEATURE],
  "/dashboard/legal/titipan/asuransi": [REPORT_ALL_FEATURE, MANAGE_ALL_FEATURE],
  "/dashboard/legal/titipan/notaris": [REPORT_ALL_FEATURE, MANAGE_ALL_FEATURE],
  "/dashboard/legal/titipan/angsuran": [REPORT_ALL_FEATURE, MANAGE_ALL_FEATURE],
  "/dashboard/legal/progress/notaris": [REPORT_ALL_FEATURE, MANAGE_ALL_FEATURE],
  "/dashboard/legal/progress/asuransi": [
    REPORT_ALL_FEATURE,
    MANAGE_ALL_FEATURE,
  ],
  "/dashboard/legal/progress/kjpp": [REPORT_ALL_FEATURE, MANAGE_ALL_FEATURE],
  "/dashboard/legal/progress/klaim": [REPORT_ALL_FEATURE, MANAGE_ALL_FEATURE],
  "/dashboard/legal/upload-ideb": [REPORT_ALL_FEATURE, MANAGE_ALL_FEATURE],
  "/dashboard/legal/laporan": [REPORT_ALL_FEATURE],
  "/dashboard/legal/laporan/pihak-ketiga/dokumen": [REPORT_ALL_FEATURE],
  "/dashboard/legal/laporan/pihak-ketiga/dana-titipan": [REPORT_ALL_FEATURE],
};

const DEBTOR_MENU_URLS = Object.keys(MENU_CAPABILITIES).filter((url) =>
  url.startsWith("/dashboard/informasi-debitur"),
);
const LEGAL_MENU_URLS = Object.keys(MENU_CAPABILITIES).filter((url) =>
  url.startsWith("/dashboard/legal"),
);

function normalizeCapabilities(capabilities) {
  return new Set(capabilities || READ_ONLY);
}

function getMenuCapabilities(menuOrUrl) {
  const url =
    typeof menuOrUrl === "string" ? menuOrUrl : String(menuOrUrl?.url || "");

  if (!url) return READ_ONLY;

  return MENU_CAPABILITIES[url] || READ_ONLY;
}

function getMenuFeatures(menuOrUrl) {
  const url =
    typeof menuOrUrl === "string" ? menuOrUrl : String(menuOrUrl?.url || "");

  if (!url) return [];

  return MENU_FEATURES[url] || [];
}

function getFeatureLabel(feature) {
  return FEATURE_LABELS[feature] || feature;
}

function getMenuFeatureOptions(menuOrUrl) {
  return getMenuFeatures(menuOrUrl).map((feature) => ({
    key: feature,
    label: getFeatureLabel(feature),
  }));
}

function buildPermissionMap(capabilities) {
  const allowedCapabilities = normalizeCapabilities(capabilities);

  return {
    can_create: allowedCapabilities.has("create"),
    can_read: allowedCapabilities.has("read"),
    can_update: allowedCapabilities.has("update"),
    can_delete: allowedCapabilities.has("delete"),
  };
}

function getMenuPermissionMap(menuOrUrl) {
  return buildPermissionMap(getMenuCapabilities(menuOrUrl));
}

function normalizeFeatures(features) {
  if (!Array.isArray(features)) return [];

  return [
    ...new Set(
      features.map((feature) => String(feature || "").trim()).filter(Boolean),
    ),
  ];
}

function getInvalidFeatures(menu, features) {
  const allowedFeatures = new Set(getMenuFeatures(menu));

  return normalizeFeatures(features).filter(
    (feature) => !allowedFeatures.has(feature),
  );
}

function getInvalidPermissionFields(menu, permission) {
  const allowedPermissions = getMenuPermissionMap(menu);

  return PERMISSION_FIELDS.filter(
    (field) => permission[field] === true && !allowedPermissions[field],
  );
}

function assertMenuFeaturesAllowed(menu, features) {
  const invalidFeatures = getInvalidFeatures(menu, features);
  if (invalidFeatures.length === 0) return;

  const allowedFeatures = getMenuFeatures(menu);
  const allowedMessage =
    allowedFeatures.length > 0 ? allowedFeatures.join(", ") : "tidak ada";

  throw new AppError(
    `Menu ${menu.name} tidak mendukung fitur: ${invalidFeatures.join(
      ", ",
    )}. Fitur yang valid: ${allowedMessage}.`,
    422,
  );
}

function assertMenuPermissionAllowed(menu, permission) {
  const invalidFields = getInvalidPermissionFields(menu, permission);
  if (invalidFields.length === 0) return;

  const allowedCapabilities = getMenuCapabilities(menu).join(", ");
  const invalidCapabilities = invalidFields
    .map((field) => FIELD_CAPABILITIES[field])
    .join(", ");

  throw new AppError(
    `Menu ${menu.name} tidak mendukung hak akses: ${invalidCapabilities}. Hak akses yang valid: ${allowedCapabilities}.`,
    422,
  );
}

function serializeMenuAccess(menu) {
  const capabilities = getMenuCapabilities(menu);

  return {
    ...menu,
    allowed_capabilities: capabilities,
    allowed_permissions: buildPermissionMap(capabilities),
    allowed_features: getMenuFeatures(menu),
    allowed_feature_options: getMenuFeatureOptions(menu),
  };
}

module.exports = {
  APPROVE_FEATURE,
  CAPABILITY_FIELDS,
  DEBTOR_MENU_URLS,
  DIVISION_MANAGER_FEATURE,
  FEATURE_LABELS,
  HANDOVER_FEATURE,
  LEGAL_MENU_URLS,
  MANAGE_ALL_FEATURE,
  MENU_CAPABILITIES,
  MENU_FEATURES,
  PERMISSION_FIELDS,
  REDISPOSE_FEATURE,
  REJECT_FEATURE,
  REPORT_ALL_FEATURE,
  RETURN_FEATURE,
  VIEW_DIVISION_FEATURE,
  assertMenuFeaturesAllowed,
  assertMenuPermissionAllowed,
  getMenuCapabilities,
  getMenuFeatureOptions,
  getMenuFeatures,
  getMenuPermissionMap,
  normalizeFeatures,
  serializeMenuAccess,
};
