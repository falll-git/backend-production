const {
  SJ_ARCHIVE_FEATURE,
  SJ_CONTACT_VERIFY_FEATURE,
  SJ_MANAGE_ALL_FEATURE,
  SJ_PROFILE_VERIFY_FEATURE,
  SJ_PUBLISH_FEATURE,
  SJ_RECONFIRM_FEATURE,
  SJ_REVIEW_FEATURE,
  SJ_SYNC_RETRY_FEATURE,
  SJ_UNPUBLISH_FEATURE,
} = require("../../src/utils/menu-access");

const SEPUTAR_JAMINAN_URLS = Object.freeze({
  root: "/dashboard/seputar-jaminan",
  summary: "/dashboard/seputar-jaminan/ringkasan",
  profile: "/dashboard/seputar-jaminan/profil",
  contacts: "/dashboard/seputar-jaminan/kontak",
  publications: "/dashboard/seputar-jaminan/publikasi",
  submissions: "/dashboard/seputar-jaminan/pengajuan",
});

const SEPUTAR_JAMINAN_MENU_TREE = Object.freeze({
  name: "Seputar Jaminan",
  url: SEPUTAR_JAMINAN_URLS.root,
  icon: "lucide lucide-store",
  order: 6,
  children: Object.freeze([
    Object.freeze({
      name: "Ringkasan",
      url: SEPUTAR_JAMINAN_URLS.summary,
      icon: "lucide lucide-layout-dashboard",
      order: 1,
    }),
    Object.freeze({
      name: "Profil BPRS",
      url: SEPUTAR_JAMINAN_URLS.profile,
      icon: "lucide lucide-building-2",
      order: 2,
    }),
    Object.freeze({
      name: "Kontak WhatsApp",
      url: SEPUTAR_JAMINAN_URLS.contacts,
      icon: "lucide lucide-message-circle",
      order: 3,
    }),
    Object.freeze({
      name: "Daftar Publikasi",
      url: SEPUTAR_JAMINAN_URLS.publications,
      icon: "lucide lucide-layout-grid",
      order: 4,
    }),
    Object.freeze({
      name: "Pengajuan",
      url: SEPUTAR_JAMINAN_URLS.submissions,
      icon: "lucide lucide-clipboard-list",
      order: 5,
    }),
  ]),
});

const SEPUTAR_JAMINAN_ADMIN_POLICIES = Object.freeze([
  Object.freeze({
    url: SEPUTAR_JAMINAN_URLS.summary,
    permissions: Object.freeze(["read", "update"]),
    features: Object.freeze([
      SJ_RECONFIRM_FEATURE,
      SJ_SYNC_RETRY_FEATURE,
      SJ_MANAGE_ALL_FEATURE,
    ]),
  }),
  Object.freeze({
    url: SEPUTAR_JAMINAN_URLS.profile,
    permissions: Object.freeze(["create", "read", "update"]),
  }),
  Object.freeze({
    url: SEPUTAR_JAMINAN_URLS.contacts,
    permissions: Object.freeze(["create", "read", "update"]),
  }),
  Object.freeze({
    url: SEPUTAR_JAMINAN_URLS.publications,
    permissions: Object.freeze(["create", "read", "update"]),
  }),
  Object.freeze({
    url: SEPUTAR_JAMINAN_URLS.submissions,
    permissions: Object.freeze(["read", "update"]),
    features: Object.freeze([
      SJ_REVIEW_FEATURE,
      SJ_PUBLISH_FEATURE,
      SJ_UNPUBLISH_FEATURE,
      SJ_ARCHIVE_FEATURE,
      SJ_CONTACT_VERIFY_FEATURE,
      SJ_PROFILE_VERIFY_FEATURE,
    ]),
  }),
]);

module.exports = {
  SEPUTAR_JAMINAN_ADMIN_POLICIES,
  SEPUTAR_JAMINAN_MENU_TREE,
  SEPUTAR_JAMINAN_URLS,
};
