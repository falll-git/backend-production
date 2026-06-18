const crypto = require("crypto");
const prisma = require("../../src/config/prisma");

const DASHBOARD_WIDGET_MENU = {
  menu_type: "DASHBOARD_WIDGET",
  placement: "DASHBOARD",
  render_in_sidebar: false,
};
const MAIN_REPORT_DASHBOARD_WIDGET_MENU = {
  menu_type: "DASHBOARD_WIDGET",
  placement: "DASHBOARD",
  render_in_sidebar: true,
};

const menuTree = [
  {
    name: "Dashboard",
    url: "/dashboard",
    icon: "lucide lucide-layout-dashboard",
    order: 1,
    children: [
      {
        name: "Penggunaan Storage",
        url: "/dashboard/storage-usage",
        icon: "lucide lucide-hard-drive",
        component_key: "dashboard.storage_usage",
        ...DASHBOARD_WIDGET_MENU,
        order: 1,
      },
    ],
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
            name: "Jatuh Tempo Peminjaman",
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
        component_key: "dashboard.module_report.digital_archive",
        ...MAIN_REPORT_DASHBOARD_WIDGET_MENU,
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
        component_key: "dashboard.module_report.correspondence",
        ...MAIN_REPORT_DASHBOARD_WIDGET_MENU,
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
            name: "Import SLIK",
            url: "/dashboard/informasi-debitur/admin/upload-slik",
            icon: "lucide lucide-cloud-upload",
            order: 1,
          },
          {
            name: "Monitoring Import",
            url: "/dashboard/informasi-debitur/admin/monitoring-import",
            icon: "lucide lucide-activity",
            order: 2,
          },
          {
            name: "Import IDEB",
            url: "/dashboard/informasi-debitur/admin/upload-ideb",
            icon: "lucide lucide-upload-cloud",
            order: 3,
          },
        ],
      },
      {
        name: "Laporan IDEB",
        url: "/dashboard/informasi-debitur/laporan-ideb",
        icon: "lucide lucide-file-search",
        order: 4,
      },
      {
        name: "Laporan Debitur",
        url: "/dashboard/informasi-debitur/laporan",
        icon: "lucide lucide-bar-chart-2",
        component_key: "dashboard.module_report.debtor",
        ...MAIN_REPORT_DASHBOARD_WIDGET_MENU,
        order: 5,
      },
      {
        name: "Laporan NPF",
        url: "/dashboard/informasi-debitur/laporan/npf",
        icon: "lucide lucide-trending-down",
        component_key: "dashboard.report.npf",
        ...DASHBOARD_WIDGET_MENU,
        order: 6,
      },
      {
        name: "Laporan Aktivitas Marketing",
        url: "/dashboard/informasi-debitur/laporan/aktivitas-marketing",
        icon: "lucide lucide-clipboard-check",
        component_key: "dashboard.report.marketing_activity",
        ...DASHBOARD_WIDGET_MENU,
        order: 7,
      },
    ],
  },
  {
    name: "Manajemen Legal",
    url: "/dashboard/legal",
    icon: "lucide lucide-scale",
    order: 5,
    children: [
      {
        name: "Progress Pihak Ketiga",
        icon: "lucide lucide-clipboard-check",
        order: 1,
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
            name: "Progress KJPP",
            url: "/dashboard/legal/progress/kjpp",
            icon: "lucide lucide-building-2",
            order: 3,
          },
          {
            name: "Tracking Claim Asuransi",
            url: "/dashboard/legal/progress/klaim",
            icon: "lucide lucide-alert-circle",
            order: 4,
          },
        ],
      },
      {
        name: "Dana Titipan",
        icon: "lucide lucide-wallet",
        order: 2,
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
          {
            name: "Dana Titipan Lainnya",
            url: "/dashboard/legal/titipan/lainnya",
            icon: "lucide lucide-wallet-cards",
            order: 4,
          },
        ],
      },
      {
        name: "Laporan Pihak 3 - Dokumen",
        url: "/dashboard/legal/laporan/pihak-ketiga/dokumen",
        icon: "lucide lucide-file-text",
        component_key: "dashboard.report.third_party_documents",
        ...DASHBOARD_WIDGET_MENU,
        order: 3,
      },
      {
        name: "Laporan Pihak 3 - Dana Titipan",
        url: "/dashboard/legal/laporan/pihak-ketiga/dana-titipan",
        icon: "lucide lucide-wallet",
        component_key: "dashboard.report.third_party_deposit_funds",
        ...DASHBOARD_WIDGET_MENU,
        order: 4,
      },
    ],
  },
  {
    name: "Parameter",
    icon: "lucide lucide-settings",
    order: 6,
    children: [
      {
        name: "Admin Sistem",
        icon: "lucide lucide-user-cog",
        order: 1,
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
            name: "Setup Cabang",
            url: "/dashboard/parameter/cabang",
            icon: "lucide lucide-building",
            order: 5,
          },
        ],
      },
      {
        name: "Arsip Digital",
        icon: "lucide lucide-archive",
        order: 2,
        children: [
          {
            name: "Setup Jenis Dokumen",
            url: "/dashboard/parameter/jenis-dokumen",
            icon: "lucide lucide-file-type",
            order: 1,
          },
          {
            name: "Setup Lokasi Arsip",
            url: "/dashboard/parameter/tempat-penyimpanan",
            icon: "lucide lucide-archive",
            order: 2,
          },
          {
            name: "Setup Watermark Dokumen",
            url: "/dashboard/parameter/watermark-dokumen",
            icon: "lucide lucide-stamp",
            order: 3,
          },
        ],
      },
      {
        name: "Persuratan",
        icon: "lucide lucide-mail",
        order: 3,
        children: [
          {
            name: "Setup Prioritas Surat",
            url: "/dashboard/parameter/prioritas-surat",
            icon: "lucide lucide-flag",
            order: 1,
          },
          {
            name: "Setup Media Pengiriman Surat",
            url: "/dashboard/parameter/media-pengiriman-surat",
            icon: "lucide lucide-send",
            order: 2,
          },
        ],
      },
      {
        name: "Debitur & Pembiayaan",
        icon: "lucide lucide-briefcase-business",
        order: 4,
        children: [
          {
            name: "Setup Produk Pembiayaan",
            url: "/dashboard/parameter/produk-pembiayaan",
            icon: "lucide lucide-package",
            order: 1,
          },
          {
            name: "Setup Jenis Akad",
            url: "/dashboard/parameter/jenis-akad",
            icon: "lucide lucide-file-signature",
            order: 2,
          },
          {
            name: "Setup Checklist Dokumen",
            url: "/dashboard/parameter/checklist-dokumen",
            icon: "lucide lucide-list-checks",
            order: 3,
          },
          {
            name: "Setup Jenis Agunan",
            url: "/dashboard/parameter/jenis-agunan",
            icon: "lucide lucide-landmark",
            order: 4,
          },
        ],
      },
      {
        name: "Manajemen Legal",
        icon: "lucide lucide-scale",
        order: 5,
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
          {
            name: "Setup KJPP",
            url: "/dashboard/parameter/pihak-ketiga/kjpp",
            icon: "lucide lucide-building-2",
            order: 3,
          },
          {
            name: "Setup Jenis Proses Legal",
            url: "/dashboard/parameter/jenis-proses-legal",
            icon: "lucide lucide-workflow",
            order: 4,
          },
          {
            name: "Setup Jenis Titipan",
            url: "/dashboard/parameter/jenis-titipan",
            icon: "lucide lucide-wallet",
            order: 5,
          },
        ],
      },
    ],
  },
];

const LEGACY_MENU_URLS = [
  "/dashboard/admin/upload-slik",
  "/dashboard/laporan/pihak-ketiga/dokumen",
  "/dashboard/laporan/pihak-ketiga/dana-titipan",
  "/dashboard/laporan/npf",
  "/dashboard/laporan/aktivitas-marketing",
  "/dashboard/parameter/template-dokumen-legal",
  "/dashboard/parameter/aktivitas-marketing",
  "/dashboard/parameter/profil-lembaga",
  "/dashboard/parameter/sla-pengingat",
  "/dashboard/arsip-digital/report",
  "/dashboard/arsip-digital/reports",
  "/dashboard/arsip-digital/laporan-arsip-digital",
  "/dashboard/arsip-digital/report-arsip-digital",
  "/dashboard/informasi-debitur/admin/import-debitur",
  "/dashboard/informasi-debitur/admin/import-kolektibilitas",
  "/dashboard/parameter/kolektibilitas",
  "/dashboard/informasi-debitur/dokumen",
  "/dashboard/informasi-debitur/marketing/surat-peringatan",
  "/dashboard/legal/upload-ideb",
  "/dashboard/legal/cetak/formulir-asuransi",
  "/dashboard/legal/template-dokumen",
  "/dashboard/legal/cetak/akad",
  "/dashboard/legal/cetak/haftsheet",
  "/dashboard/legal/cetak/surat-peringatan",
  "/dashboard/legal/cetak/surat-pengantar",
  "/dashboard/legal/cetak/keterangan-lunas",
  "/dashboard/legal/cetak/surat-samsat",
  "/dashboard/legal/cetak/dokumen-lainnya",
  "/dashboard/legal/laporan",
  "/dashboard/parameter/template-penomoran",
];

const LEGACY_EMPTY_MENU_NAMES = [
  "Admin",
  "Cetak Dokumen Legal",
  "Input Progress",
  "Input Progres PHK3",
  "Laporan",
  "Master Pihak Ketiga",
  "Penomoran Dokumen",
  "Setup Pihak Ketiga",
];

async function seedMenus() {
  console.log("Seeding menus...");

  async function upsertMenus(nodes, parentId = null, parentName = null) {
    for (const node of nodes) {
      const url = node.url || "";
      let existing = null;

      if (url) {
        existing = await prisma.menus.findFirst({ where: { url } });
      }

      if (!existing) {
        existing = await prisma.menus.findFirst({
          where: {
            name: node.name,
            parent_id: parentId,
          },
        });
      }
      const data = {
        name: node.name,
        url,
        icon: node.icon || null,
        menu_type: node.menu_type || "NAVIGATION",
        placement: node.placement || "SIDEBAR",
        render_in_sidebar: node.render_in_sidebar ?? true,
        component_key: node.component_key || null,
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
