const crypto = require("crypto");
const prisma = require("../../src/config/prisma");

const menuTree = [
  {
    name: "Dashboard",
    url: "/dashboard",
    icon: "lucide lucide-layout-dashboard",
    order: 1,
  },
  {
    name: "Arsip Digital",
    icon: "lucide lucide-archive",
    order: 2,
    children: [
      {
        name: "Input Dokumen",
        url: "/dashboard/arsip-digital/input-dokumen",
        icon: "lucide lucide-file-plus",
        order: 1,
      },
      {
        name: "Ruang Arsip",
        icon: "lucide lucide-folder",
        order: 2,
        children: [
          {
            name: "Tempat Penyimpanan",
            url: "/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan",
            icon: "lucide lucide-archive",
            order: 1,
          },
          {
            name: "List Dokumen",
            url: "/dashboard/arsip-digital/ruang-arsip/list-dokumen",
            icon: "lucide lucide-list",
            order: 2,
          },
          {
            name: "Jatuh Tempo",
            url: "/dashboard/arsip-digital/ruang-arsip/jatuh-tempo",
            icon: "lucide lucide-clock",
            order: 3,
          },
        ],
      },
      {
        name: "Disposisi",
        icon: "lucide lucide-arrow-left-right",
        order: 3,
        children: [
          {
            name: "Pengajuan Disposisi",
            url: "/dashboard/arsip-digital/disposisi/pengajuan",
            icon: "lucide lucide-file-plus",
            order: 1,
          },
          {
            name: "Permintaan Disposisi",
            url: "/dashboard/arsip-digital/disposisi/permintaan",
            icon: "lucide lucide-inbox",
            order: 2,
          },
          {
            name: "Historis Disposisi",
            url: "/dashboard/arsip-digital/disposisi/historis",
            icon: "lucide lucide-history",
            order: 3,
          },
        ],
      },
      {
        name: "Peminjaman Fisik",
        icon: "lucide lucide-book-open",
        order: 4,
        children: [
          {
            name: "Request Peminjaman",
            url: "/dashboard/arsip-digital/peminjaman/request",
            icon: "lucide lucide-send",
            order: 1,
          },
          {
            name: "Accept Peminjaman",
            url: "/dashboard/arsip-digital/peminjaman/accept",
            icon: "lucide lucide-check-square",
            order: 2,
          },
          {
            name: "Laporan Peminjaman",
            url: "/dashboard/arsip-digital/peminjaman/laporan",
            icon: "lucide lucide-bar-chart-2",
            order: 3,
          },
        ],
      },
      {
        name: "Historis",
        icon: "lucide lucide-history",
        order: 5,
        children: [
          {
            name: "Historis Penyimpanan",
            url: "/dashboard/arsip-digital/historis/penyimpanan",
            icon: "lucide lucide-archive",
            order: 1,
          },
          {
            name: "Historis Peminjaman",
            url: "/dashboard/arsip-digital/historis/peminjaman",
            icon: "lucide lucide-book-open",
            order: 2,
          },
        ],
      },
      {
        name: "Laporan Arsip Digital",
        url: "/dashboard/arsip-digital/laporan",
        icon: "lucide lucide-bar-chart-3",
        order: 6,
      },
    ],
  },
  {
    name: "Manajemen Surat",
    icon: "lucide lucide-mail",
    order: 3,
    children: [
      {
        name: "Kelola Surat",
        icon: "lucide lucide-folder",
        order: 1,
        children: [
          {
            name: "Input Surat Masuk",
            url: "/dashboard/manajemen-surat/kelola-surat/input-surat-masuk",
            icon: "lucide lucide-file-input",
            order: 1,
          },
          {
            name: "Input Surat Keluar",
            url: "/dashboard/manajemen-surat/kelola-surat/input-surat-keluar",
            icon: "lucide lucide-file-output",
            order: 2,
          },
          {
            name: "Input Memorandum",
            url: "/dashboard/manajemen-surat/kelola-surat/input-memorandum",
            icon: "lucide lucide-file-text",
            order: 3,
          },
        ],
      },
      {
        name: "Laporan Persuratan",
        url: "/dashboard/manajemen-surat/laporan",
        icon: "lucide lucide-bar-chart-2",
        order: 2,
      },
      {
        name: "Cetak Dokumen",
        url: "/dashboard/manajemen-surat/cetak-dokumen",
        icon: "lucide lucide-printer",
        order: 3,
      },
    ],
  },
  {
    name: "Informasi Debitur",
    icon: "lucide lucide-users",
    order: 4,
    children: [
      {
        name: "Data Debitur",
        icon: "lucide lucide-users",
        order: 1,
        children: [
          {
            name: "List Debitur",
            url: "/dashboard/informasi-debitur",
            icon: "lucide lucide-list",
            order: 1,
          },
          {
            name: "Master Debitur & Kontrak",
            url: "/dashboard/informasi-debitur/master-debitur",
            icon: "lucide lucide-contact",
            order: 2,
          },
        ],
      },
      {
        name: "Aktivitas Marketing",
        icon: "lucide lucide-clipboard-check",
        order: 2,
        children: [
          {
            name: "Action Plan",
            url: "/dashboard/informasi-debitur/marketing/action-plan",
            icon: "lucide lucide-clipboard-check",
            order: 1,
          },
          {
            name: "Hasil Kunjungan",
            url: "/dashboard/informasi-debitur/marketing/hasil-kunjungan",
            icon: "lucide lucide-file-text",
            order: 2,
          },
          {
            name: "Langkah Penanganan",
            url: "/dashboard/informasi-debitur/marketing/langkah-penanganan",
            icon: "lucide lucide-clipboard-list",
            order: 3,
          },
        ],
      },
      {
        name: "Import Data",
        icon: "lucide lucide-cloud-upload",
        order: 3,
        children: [
          {
            name: "Upload Data SLIK",
            url: "/dashboard/informasi-debitur/admin/upload-slik",
            icon: "lucide lucide-cloud-upload",
            order: 1,
          },
          {
            name: "Upload Data Restrik",
            url: "/dashboard/informasi-debitur/admin/upload-restrik",
            icon: "lucide lucide-cloud-upload",
            order: 2,
          },
          {
            name: "Import Master Debitur & Kontrak",
            url: "/dashboard/informasi-debitur/admin/import-debitur",
            icon: "lucide lucide-file-spreadsheet",
            order: 3,
          },
          {
            name: "Import Kolektibilitas & Outstanding",
            url: "/dashboard/informasi-debitur/admin/import-kolektibilitas",
            icon: "lucide lucide-file-spreadsheet",
            order: 4,
          },
        ],
      },
      {
        name: "Laporan Debitur",
        url: "/dashboard/informasi-debitur/laporan",
        icon: "lucide lucide-bar-chart-2",
        order: 4,
      },
      {
        name: "Laporan NPF",
        url: "/dashboard/informasi-debitur/laporan/npf",
        icon: "lucide lucide-trending-down",
        order: 5,
      },
      {
        name: "Laporan Aktivitas Marketing",
        url: "/dashboard/informasi-debitur/laporan/aktivitas-marketing",
        icon: "lucide lucide-clipboard-check",
        order: 6,
      },
    ],
  },
  {
    name: "Manajemen Legal",
    icon: "lucide lucide-scale",
    order: 5,
    children: [
      {
        name: "Template Dokumen Legal",
        url: "/dashboard/legal/template-dokumen",
        icon: "lucide lucide-file-text",
        order: 1,
      },
      {
        name: "Cetak Dokumen Legal",
        icon: "lucide lucide-printer",
        order: 2,
        children: [
          {
            name: "Dokumen Akad",
            url: "/dashboard/legal/cetak/akad",
            icon: "lucide lucide-file-text",
            order: 1,
          },
          {
            name: "Haftsheet",
            url: "/dashboard/legal/cetak/haftsheet",
            icon: "lucide lucide-check-square",
            order: 2,
          },
          {
            name: "Surat Peringatan",
            url: "/dashboard/legal/cetak/surat-peringatan",
            icon: "lucide lucide-mail",
            order: 3,
          },
          {
            name: "Formulir Asuransi",
            url: "/dashboard/legal/cetak/formulir-asuransi",
            icon: "lucide lucide-shield",
            order: 4,
          },
          {
            name: "Surat Keterangan Lunas",
            url: "/dashboard/legal/cetak/keterangan-lunas",
            icon: "lucide lucide-award",
            order: 5,
          },
          {
            name: "Surat Samsat",
            url: "/dashboard/legal/cetak/surat-samsat",
            icon: "lucide lucide-car",
            order: 6,
          },
        ],
      },
      {
        name: "Dana Titipan",
        icon: "lucide lucide-wallet",
        order: 3,
        children: [
          {
            name: "Dana Titipan Asuransi",
            url: "/dashboard/legal/titipan/asuransi",
            icon: "lucide lucide-shield",
            order: 1,
          },
          {
            name: "Dana Titipan Notaris",
            url: "/dashboard/legal/titipan/notaris",
            icon: "lucide lucide-scale",
            order: 2,
          },
          {
            name: "Dana Titipan Angsuran",
            url: "/dashboard/legal/titipan/angsuran",
            icon: "lucide lucide-wallet",
            order: 3,
          },
        ],
      },
      {
        name: "Input Progres PHK3",
        icon: "lucide lucide-clipboard-check",
        order: 4,
        children: [
          {
            name: "Progress Notaris",
            url: "/dashboard/legal/progress/notaris",
            icon: "lucide lucide-scale",
            order: 1,
          },
          {
            name: "Progress Asuransi",
            url: "/dashboard/legal/progress/asuransi",
            icon: "lucide lucide-shield",
            order: 2,
          },
          {
            name: "Tracking Claim Asuransi",
            url: "/dashboard/legal/progress/klaim",
            icon: "lucide lucide-alert-circle",
            order: 3,
          },
        ],
      },
      {
        name: "Upload Ideb",
        url: "/dashboard/legal/upload-ideb",
        icon: "lucide lucide-upload-cloud",
        order: 5,
      },
      {
        name: "Laporan Pihak 3 - Dokumen",
        url: "/dashboard/legal/laporan/pihak-ketiga/dokumen",
        icon: "lucide lucide-file-text",
        order: 6,
      },
      {
        name: "Laporan Pihak 3 - Dana Titipan",
        url: "/dashboard/legal/laporan/pihak-ketiga/dana-titipan",
        icon: "lucide lucide-wallet",
        order: 7,
      },
      {
        name: "Laporan Legal",
        url: "/dashboard/legal/laporan",
        icon: "lucide lucide-bar-chart-2",
        order: 8,
      },
    ],
  },
  {
    name: "Parameter",
    icon: "lucide lucide-settings",
    order: 6,
    children: [
      {
        name: "Manajemen User",
        url: "/dashboard/users",
        icon: "lucide lucide-user-cog",
        order: 1,
      },
      {
        name: "Setup Role",
        url: "/dashboard/parameter/role",
        icon: "lucide lucide-shield",
        order: 2,
      },
      {
        name: "Setup Role Per Menu",
        url: "/dashboard/parameter/role-menu",
        icon: "lucide lucide-key",
        order: 3,
      },
      {
        name: "Setup Divisi",
        url: "/dashboard/parameter/divisi",
        icon: "lucide lucide-briefcase",
        order: 4,
      },
      {
        name: "Setup Jenis Dokumen",
        url: "/dashboard/parameter/jenis-dokumen",
        icon: "lucide lucide-file-type",
        order: 5,
      },
      {
        name: "Setup Lokasi Arsip",
        url: "/dashboard/parameter/tempat-penyimpanan",
        icon: "lucide lucide-archive",
        order: 6,
      },
      {
        name: "Setup Prioritas Surat",
        url: "/dashboard/parameter/prioritas-surat",
        icon: "lucide lucide-flag",
        order: 7,
      },
      {
        name: "Setup Pihak Ketiga",
        icon: "lucide lucide-building-2",
        order: 8,
        children: [
          {
            name: "Setup Notaris",
            url: "/dashboard/parameter/pihak-ketiga/notaris",
            icon: "lucide lucide-scale",
            order: 1,
          },
          {
            name: "Setup Perusahaan Asuransi",
            url: "/dashboard/parameter/pihak-ketiga/perusahaan-asuransi",
            icon: "lucide lucide-shield",
            order: 2,
          },
        ],
      },
      {
        name: "Setup Template Penomoran",
        url: "/dashboard/parameter/template-penomoran",
        icon: "lucide lucide-hash",
        order: 9,
      },
      {
        name: "Setup Checklist Dokumen",
        url: "/dashboard/parameter/checklist-dokumen",
        icon: "lucide lucide-list-checks",
        order: 10,
      },
      {
        name: "Setup Produk Pembiayaan",
        url: "/dashboard/parameter/produk-pembiayaan",
        icon: "lucide lucide-package",
        order: 11,
      },
      {
        name: "Setup Jenis Akad",
        url: "/dashboard/parameter/jenis-akad",
        icon: "lucide lucide-file-signature",
        order: 12,
      },
      {
        name: "Setup Kolektibilitas",
        url: "/dashboard/parameter/kolektibilitas",
        icon: "lucide lucide-list-ordered",
        order: 13,
      },
      {
        name: "Setup Cabang",
        url: "/dashboard/parameter/cabang",
        icon: "lucide lucide-building",
        order: 14,
      },
      {
        name: "Setup Profil Lembaga",
        url: "/dashboard/parameter/profil-lembaga",
        icon: "lucide lucide-landmark",
        order: 15,
      },
      {
        name: "Setup SLA & Pengingat",
        url: "/dashboard/parameter/sla-pengingat",
        icon: "lucide lucide-bell-ring",
        order: 16,
      },
      {
        name: "Setup Aktivitas Marketing",
        url: "/dashboard/parameter/aktivitas-marketing",
        icon: "lucide lucide-clipboard-check",
        order: 17,
      },
      {
        name: "Setup Jenis Titipan",
        url: "/dashboard/parameter/jenis-titipan",
        icon: "lucide lucide-wallet",
        order: 18,
      },
    ],
  },
];

const LEGACY_MENU_URLS = [
  "/dashboard/admin/upload-slik",
  "/dashboard/admin/upload-restrik",
  "/dashboard/laporan/pihak-ketiga/dokumen",
  "/dashboard/laporan/pihak-ketiga/dana-titipan",
  "/dashboard/laporan/npf",
  "/dashboard/laporan/aktivitas-marketing",
  "/dashboard/parameter/template-dokumen-legal",
];

const LEGACY_EMPTY_MENU_NAMES = [
  "Admin",
  "Input Progress",
  "Laporan",
  "Master Pihak Ketiga",
];

async function seedMenus() {
  console.log("Seeding menus...");

  async function upsertMenus(nodes, parentId = null, parentName = null) {
    for (const node of nodes) {
      const url = node.url || "";
      const existing = url
        ? await prisma.menus.findFirst({ where: { url } })
        : await prisma.menus.findFirst({
            where: {
              name: node.name,
              parent_id: parentId,
            },
          });
      const data = {
        name: node.name,
        url,
        icon: node.icon || null,
        order: node.order,
        parent_id: parentId,
        parent_label: parentName,
      };
      const menu = existing
        ? await prisma.menus.update({
            where: { id: existing.id },
            data,
          })
        : await prisma.menus.create({
            data: {
              ...data,
              id: crypto.randomUUID(),
            },
          });

      if (node.children && node.children.length > 0) {
        await upsertMenus(node.children, menu.id, menu.name);
      }
    }
  }

  await upsertMenus(menuTree);

  const legacyMenusByUrl = await prisma.menus.findMany({
    where: {
      url: {
        in: LEGACY_MENU_URLS,
      },
    },
  });

  for (const menu of legacyMenusByUrl) {
    await prisma.role_menus.deleteMany({ where: { menu_id: menu.id } });
    await prisma.menus.delete({ where: { id: menu.id } });
  }

  const legacyEmptyMenus = await prisma.menus.findMany({
    where: {
      name: {
        in: LEGACY_EMPTY_MENU_NAMES,
      },
      url: "",
    },
  });

  for (const menu of legacyEmptyMenus) {
    const childrenCount = await prisma.menus.count({
      where: { parent_id: menu.id },
    });

    if (childrenCount === 0) {
      await prisma.role_menus.deleteMany({ where: { menu_id: menu.id } });
      await prisma.menus.delete({ where: { id: menu.id } });
    }
  }

  console.log("Menus seeded!");
}

module.exports = { seedMenus };
