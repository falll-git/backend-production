const crypto = require("crypto");
const prisma = require("../../src/config/prisma");

const ROLES = {
  MANAJER: "Manajer",
  ADMIN: "Admin",
  LEGAL: "Legal",
  IT: "IT",
};

function permission({
  roles,
  can_create = false,
  can_update = false,
  can_delete = false,
}) {
  return Object.fromEntries(
    roles.map((role) => [
      role,
      {
        can_create,
        can_read: true,
        can_update,
        can_delete,
      },
    ]),
  );
}

const READ_ALL_ROLES = permission({
  roles: [ROLES.MANAJER, ROLES.ADMIN, ROLES.LEGAL, ROLES.IT],
});
const ADMIN_WRITE = permission({
  roles: [ROLES.ADMIN],
  can_create: true,
  can_update: true,
  can_delete: true,
});
const ADMIN_LEGAL_WRITE = permission({
  roles: [ROLES.ADMIN, ROLES.LEGAL],
  can_create: true,
  can_update: true,
  can_delete: true,
});
const ADMIN_LEGAL_CREATE = permission({
  roles: [ROLES.ADMIN, ROLES.LEGAL],
  can_create: true,
});
const ADMIN_LEGAL_UPDATE = permission({
  roles: [ROLES.ADMIN, ROLES.LEGAL],
  can_update: true,
});
const DISPOSITION_CREATE = permission({
  roles: [ROLES.MANAJER, ROLES.ADMIN, ROLES.LEGAL],
  can_create: true,
});
const DISPOSITION_UPDATE = permission({
  roles: [ROLES.MANAJER, ROLES.ADMIN, ROLES.LEGAL],
  can_update: true,
});
const ADMIN_IT_WRITE = permission({
  roles: [ROLES.ADMIN, ROLES.IT],
  can_create: true,
  can_update: true,
  can_delete: true,
});
const IT_WRITE = permission({
  roles: [ROLES.IT],
  can_create: true,
  can_update: true,
  can_delete: true,
});
const LEGAL_WRITE = permission({
  roles: [ROLES.LEGAL],
  can_create: true,
  can_update: true,
  can_delete: true,
});
const LEGAL_IT_READ = permission({
  roles: [ROLES.LEGAL, ROLES.IT],
});
const LEGAL_IT_UPLOAD = permission({
  roles: [ROLES.LEGAL, ROLES.IT],
  can_create: true,
  can_update: true,
  can_delete: true,
});
const LEGAL_REPORT = permission({
  roles: [ROLES.MANAJER, ROLES.LEGAL, ROLES.IT],
});

const MENU_PERMISSIONS = {
  "/dashboard": READ_ALL_ROLES,

  "/dashboard/arsip-digital/input-dokumen": ADMIN_LEGAL_WRITE,
  "/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan": {
    ...READ_ALL_ROLES,
    ...ADMIN_LEGAL_WRITE,
  },
  "/dashboard/arsip-digital/ruang-arsip/list-dokumen": {
    ...READ_ALL_ROLES,
    ...ADMIN_LEGAL_WRITE,
  },
  "/dashboard/arsip-digital/ruang-arsip/jatuh-tempo": READ_ALL_ROLES,
  "/dashboard/arsip-digital/disposisi/pengajuan": DISPOSITION_CREATE,
  "/dashboard/arsip-digital/disposisi/permintaan": DISPOSITION_UPDATE,
  "/dashboard/arsip-digital/disposisi/historis": READ_ALL_ROLES,
  "/dashboard/arsip-digital/peminjaman/request": ADMIN_LEGAL_CREATE,
  "/dashboard/arsip-digital/peminjaman/accept": ADMIN_LEGAL_UPDATE,
  "/dashboard/arsip-digital/peminjaman/laporan": READ_ALL_ROLES,
  "/dashboard/arsip-digital/historis/penyimpanan": READ_ALL_ROLES,
  "/dashboard/arsip-digital/historis/peminjaman": READ_ALL_ROLES,

  "/dashboard/manajemen-surat/kelola-surat/input-surat-masuk": ADMIN_WRITE,
  "/dashboard/manajemen-surat/kelola-surat/input-surat-keluar": ADMIN_WRITE,
  "/dashboard/manajemen-surat/kelola-surat/input-memorandum": ADMIN_WRITE,
  "/dashboard/manajemen-surat/laporan": READ_ALL_ROLES,
  "/dashboard/manajemen-surat/cetak-dokumen": READ_ALL_ROLES,

  "/dashboard/informasi-debitur": READ_ALL_ROLES,
  "/dashboard/informasi-debitur/marketing/action-plan": ADMIN_WRITE,
  "/dashboard/informasi-debitur/marketing/hasil-kunjungan": ADMIN_WRITE,
  "/dashboard/informasi-debitur/marketing/langkah-penanganan": ADMIN_WRITE,

  "/dashboard/legal/cetak/akad": LEGAL_IT_READ,
  "/dashboard/legal/cetak/haftsheet": LEGAL_IT_READ,
  "/dashboard/legal/cetak/surat-peringatan": LEGAL_IT_READ,
  "/dashboard/legal/cetak/formulir-asuransi": LEGAL_IT_READ,
  "/dashboard/legal/cetak/keterangan-lunas": LEGAL_IT_READ,
  "/dashboard/legal/cetak/surat-samsat": LEGAL_IT_READ,
  "/dashboard/legal/titipan/asuransi": LEGAL_WRITE,
  "/dashboard/legal/titipan/notaris": LEGAL_WRITE,
  "/dashboard/legal/titipan/angsuran": LEGAL_WRITE,
  "/dashboard/legal/progress/notaris": LEGAL_WRITE,
  "/dashboard/legal/progress/asuransi": LEGAL_WRITE,
  "/dashboard/legal/progress/klaim": LEGAL_WRITE,
  "/dashboard/legal/upload-ideb": LEGAL_IT_UPLOAD,
  "/dashboard/legal/laporan": LEGAL_REPORT,

  "/dashboard/admin/upload-slik": ADMIN_IT_WRITE,
  "/dashboard/admin/upload-restrik": ADMIN_IT_WRITE,
  "/dashboard/parameter/divisi": IT_WRITE,
  "/dashboard/parameter/tempat-penyimpanan": IT_WRITE,
  "/dashboard/parameter/jenis-dokumen": IT_WRITE,
  "/dashboard/parameter/prioritas-surat": IT_WRITE,
  "/dashboard/parameter/role": IT_WRITE,
  "/dashboard/parameter/role-menu": IT_WRITE,
  "/dashboard/users": IT_WRITE,
};

function mergePermissions(current, next) {
  return {
    can_create: Boolean(current?.can_create || next.can_create),
    can_read: Boolean(current?.can_read || next.can_read),
    can_update: Boolean(current?.can_update || next.can_update),
    can_delete: Boolean(current?.can_delete || next.can_delete),
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

async function seedRoleMenus() {
  console.log("Seeding role menus...");

  const menus = await prisma.menus.findMany();
  const roles = await prisma.roles.findMany();

  const rolesByName = new Map(roles.map((role) => [role.name, role]));
  const menusByUrl = new Map(
    menus
      .filter((menu) => menu.url)
      .map((menu) => [menu.url, menu]),
  );
  const menusById = new Map(menus.map((menu) => [menu.id, menu]));
  const roleMenusByKey = new Map();

  for (const roleName of Object.values(ROLES)) {
    if (!rolesByName.has(roleName)) {
      throw new Error(`Role seed tidak lengkap: ${roleName} tidak ditemukan.`);
    }
  }

  for (const [url, permissionsByRole] of Object.entries(MENU_PERMISSIONS)) {
    const menu = menusByUrl.get(url);
    if (!menu) {
      throw new Error(`Menu seed tidak lengkap: ${url} tidak ditemukan.`);
    }

    for (const [roleName, permissionValue] of Object.entries(permissionsByRole)) {
      const role = rolesByName.get(roleName);
      addPermission(roleMenusByKey, menu.id, role.id, permissionValue);

      let parentId = menu.parent_id;
      while (parentId) {
        const parent = menusById.get(parentId);
        if (!parent) break;
        addPermission(roleMenusByKey, parent.id, role.id, {
          can_create: false,
          can_read: true,
          can_update: false,
          can_delete: false,
        });
        parentId = parent.parent_id;
      }
    }
  }

  const expectedRoleMenus = Array.from(roleMenusByKey.values());
  const expectedKeys = new Set(roleMenusByKey.keys());
  const managedRoleIds = Object.values(ROLES).map(
    (roleName) => rolesByName.get(roleName).id,
  );
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
    await prisma.role_menus.updateMany({
      where: {
        id: {
          in: staleRoleMenuIds,
        },
      },
      data: {
        can_create: false,
        can_read: false,
        can_update: false,
        can_delete: false,
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
