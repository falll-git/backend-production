const crypto = require("crypto");
const prisma = require("../../src/config/prisma");
const {
  APPROVE_FEATURE,
  HANDOVER_FEATURE,
  REDISPOSE_FEATURE,
  REJECT_FEATURE,
  REPORT_ALL_FEATURE,
  RETURN_FEATURE,
} = require("../../src/utils/menu-access");

const SEEDED_MAIN_ROLES = ["Admin", "Staf", "Supervisor", "Manager", "IT"];
const BOOTSTRAP_ROLE = "IT";
const DASHBOARD_URL = "/dashboard";
const URLS = {
  dashboard: DASHBOARD_URL,

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

  users: "/dashboard/users",
  role: "/dashboard/parameter/role",
  roleMenu: "/dashboard/parameter/role-menu",
  division: "/dashboard/parameter/divisi",
  documentType: "/dashboard/parameter/jenis-dokumen",
  storage: "/dashboard/parameter/tempat-penyimpanan",
  letterPriority: "/dashboard/parameter/prioritas-surat",
};
const CORE_PARAMETER_URLS = [
  URLS.users,
  URLS.role,
  URLS.roleMenu,
  URLS.division,
  URLS.documentType,
  URLS.storage,
  URLS.letterPriority,
];
const BASIC_MASTER_DATA_URLS = [
  URLS.division,
  URLS.documentType,
  URLS.storage,
  URLS.letterPriority,
];
const DISABLED_MENU_ROOT_NAMES = [
  "Informasi Debitur",
  "Manajemen Legal",
];
const DISABLED_MENU_BRANCHES = [
  { name: "Setup Pihak Ketiga", parentLabel: "Parameter" },
];
const DISABLED_MENU_URLS = [
  "/dashboard/parameter/pihak-ketiga/notaris",
  "/dashboard/parameter/pihak-ketiga/perusahaan-asuransi",
  "/dashboard/parameter/template-penomoran",
  "/dashboard/parameter/checklist-dokumen",
  "/dashboard/parameter/produk-pembiayaan",
  "/dashboard/parameter/jenis-akad",
  "/dashboard/parameter/kolektibilitas",
  "/dashboard/parameter/cabang",
  "/dashboard/parameter/profil-lembaga",
  "/dashboard/parameter/sla-pengingat",
  "/dashboard/parameter/aktivitas-marketing",
  "/dashboard/parameter/jenis-titipan",
];
const ROLE_MENU_POLICIES = {
  IT: [
    { url: URLS.dashboard, permissions: ["read"] },
    ...CORE_PARAMETER_URLS.map((url) => ({
      url,
      permissions: ["create", "read", "update", "delete"],
    })),
  ],
  Admin: [
    { url: URLS.dashboard, permissions: ["read"] },

    { url: URLS.archiveInput, permissions: ["create", "read"] },
    { url: URLS.archiveStorage, permissions: ["read"] },
    {
      url: URLS.archiveList,
      permissions: ["create", "read", "update", "delete"],
    },
    { url: URLS.archiveDueDate, permissions: ["read"] },
    { url: URLS.archiveAccessRequest, permissions: ["create", "read"] },
    { url: URLS.archiveAccessHistory, permissions: ["read"] },
    { url: URLS.archiveLoanRequest, permissions: ["create", "read"] },
    { url: URLS.archiveLoanReport, permissions: ["read"] },
    { url: URLS.archiveStorageHistory, permissions: ["read"] },
    { url: URLS.archiveLoanHistory, permissions: ["read"] },
    {
      url: URLS.archiveReport,
      permissions: ["read"],
      features: [REPORT_ALL_FEATURE],
    },

    {
      url: URLS.incomingMail,
      permissions: ["create", "read", "update", "delete"],
    },
    {
      url: URLS.outgoingMail,
      permissions: ["create", "read", "update", "delete"],
    },
    {
      url: URLS.memorandum,
      permissions: ["create", "read", "update", "delete"],
    },
    {
      url: URLS.correspondenceReport,
      permissions: ["read"],
      features: [REPORT_ALL_FEATURE],
    },
    {
      url: URLS.correspondencePrint,
      permissions: ["read"],
      features: [REPORT_ALL_FEATURE],
    },

    ...BASIC_MASTER_DATA_URLS.map((url) => ({
      url,
      permissions: ["create", "read", "update", "delete"],
    })),
  ],
  Manager: [
    { url: URLS.dashboard, permissions: ["read"] },

    { url: URLS.archiveStorage, permissions: ["read"] },
    { url: URLS.archiveList, permissions: ["read"] },
    { url: URLS.archiveDueDate, permissions: ["read"] },
    {
      url: URLS.archiveAccessApproval,
      permissions: ["read", "update"],
      features: [APPROVE_FEATURE, REJECT_FEATURE],
    },
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
    { url: URLS.archiveAccessHistory, permissions: ["read"] },
    { url: URLS.archiveLoanReport, permissions: ["read"] },
    { url: URLS.archiveStorageHistory, permissions: ["read"] },
    { url: URLS.archiveLoanHistory, permissions: ["read"] },
    {
      url: URLS.archiveReport,
      permissions: ["read"],
      features: [REPORT_ALL_FEATURE],
    },

    {
      url: URLS.incomingMail,
      permissions: ["read", "update"],
      features: [REDISPOSE_FEATURE],
    },
    { url: URLS.outgoingMail, permissions: ["read"] },
    {
      url: URLS.memorandum,
      permissions: ["read", "update"],
      features: [REDISPOSE_FEATURE],
    },
    {
      url: URLS.correspondenceReport,
      permissions: ["read"],
      features: [REPORT_ALL_FEATURE],
    },
    {
      url: URLS.correspondencePrint,
      permissions: ["read"],
      features: [REPORT_ALL_FEATURE],
    },
  ],
  Supervisor: [
    { url: URLS.dashboard, permissions: ["read"] },

    { url: URLS.archiveStorage, permissions: ["read"] },
    { url: URLS.archiveList, permissions: ["read"] },
    { url: URLS.archiveDueDate, permissions: ["read"] },
    {
      url: URLS.archiveAccessApproval,
      permissions: ["read", "update"],
      features: [APPROVE_FEATURE, REJECT_FEATURE],
    },
    { url: URLS.archiveAccessHistory, permissions: ["read"] },
    { url: URLS.archiveLoanReport, permissions: ["read"] },
    { url: URLS.archiveStorageHistory, permissions: ["read"] },
    { url: URLS.archiveLoanHistory, permissions: ["read"] },
    {
      url: URLS.archiveReport,
      permissions: ["read"],
      features: [REPORT_ALL_FEATURE],
    },

    {
      url: URLS.incomingMail,
      permissions: ["read", "update"],
      features: [REDISPOSE_FEATURE],
    },
    { url: URLS.outgoingMail, permissions: ["read"] },
    {
      url: URLS.memorandum,
      permissions: ["read", "update"],
      features: [REDISPOSE_FEATURE],
    },
    {
      url: URLS.correspondenceReport,
      permissions: ["read"],
      features: [REPORT_ALL_FEATURE],
    },
    {
      url: URLS.correspondencePrint,
      permissions: ["read"],
      features: [REPORT_ALL_FEATURE],
    },
  ],
  Staf: [
    { url: URLS.dashboard, permissions: ["read"] },

    { url: URLS.archiveInput, permissions: ["create", "read"] },
    { url: URLS.archiveStorage, permissions: ["read"] },
    { url: URLS.archiveList, permissions: ["read", "update"] },
    { url: URLS.archiveDueDate, permissions: ["read"] },
    { url: URLS.archiveAccessRequest, permissions: ["create", "read"] },
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
  ],
};

function buildPermission({ permissions = ["read"], features = [] } = {}) {
  const permissionSet = new Set(permissions);

  return {
    can_create: permissionSet.has("create"),
    can_read: permissionSet.has("read"),
    can_update: permissionSet.has("update"),
    can_delete: permissionSet.has("delete"),
    features,
  };
}

function mergePermissions(current, next) {
  return {
    can_create: Boolean(current?.can_create || next.can_create),
    can_read: Boolean(current?.can_read || next.can_read),
    can_update: Boolean(current?.can_update || next.can_update),
    can_delete: Boolean(current?.can_delete || next.can_delete),
    features: [
      ...new Set([...(current?.features || []), ...(next.features || [])]),
    ],
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

function collectDescendantMenuIds(menu, menusByParentId, store) {
  store.add(menu.id);

  for (const child of menusByParentId.get(menu.id) || []) {
    collectDescendantMenuIds(child, menusByParentId, store);
  }
}

async function seedRoleMenus() {
  console.log("Seeding role menus...");

  const menus = await prisma.menus.findMany();
  const roles = await prisma.roles.findMany({
    where: {
      name: {
        in: SEEDED_MAIN_ROLES,
      },
    },
  });

  const rolesByName = new Map(roles.map((role) => [role.name, role]));
  const bootstrapRole = rolesByName.get(BOOTSTRAP_ROLE);

  if (!bootstrapRole) {
    throw new Error(`Role seed tidak lengkap: ${BOOTSTRAP_ROLE} tidak ditemukan.`);
  }

  for (const roleName of SEEDED_MAIN_ROLES) {
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
      collectDescendantMenuIds(menu, menusByParentId, disabledMenuIds);
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

  if (disabledMenuIds.size > 0) {
    await prisma.role_menus.deleteMany({
      where: {
        menu_id: {
          in: Array.from(disabledMenuIds),
        },
      },
    });
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
  const expectedKeys = new Set(roleMenusByKey.keys());
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

  const staleRoleMenuIds = existingRoleMenus
    .filter((item) => !expectedKeys.has(`${item.role_id}:${item.menu_id}`))
    .map((item) => item.id);

  if (staleRoleMenuIds.length > 0) {
    await prisma.role_menus.deleteMany({
      where: {
        id: {
          in: staleRoleMenuIds,
        },
      },
    });
  }

  for (const roleMenu of expectedRoleMenus) {
    await prisma.role_menus.upsert({
      where: {
        role_id_menu_id: {
          role_id: roleMenu.role_id,
          menu_id: roleMenu.menu_id,
        },
      },
      update: {
        can_create: roleMenu.can_create,
        can_read: roleMenu.can_read,
        can_update: roleMenu.can_update,
        can_delete: roleMenu.can_delete,
        features: roleMenu.features,
      },
      create: {
        id: crypto.randomUUID(),
        ...roleMenu,
      },
    });
  }

  console.log("Role menus seeded!");
}

module.exports = { seedRoleMenus };
