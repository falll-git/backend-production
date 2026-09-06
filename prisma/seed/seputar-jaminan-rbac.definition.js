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
  catalog: "/dashboard/seputar-jaminan/katalog",
  review: "/dashboard/seputar-jaminan/pemeriksaan",
  profileContact: "/dashboard/seputar-jaminan/profil-kontak",
});

const SEPUTAR_JAMINAN_MENU_TREE = Object.freeze({
  name: "Seputar Jaminan",
  url: SEPUTAR_JAMINAN_URLS.root,
  icon: "lucide lucide-store",
  order: 6,
  children: Object.freeze([
    Object.freeze({
      name: "Katalog Aset",
      url: SEPUTAR_JAMINAN_URLS.catalog,
      icon: "lucide lucide-layout-grid",
      order: 1,
    }),
    Object.freeze({
      name: "Pemeriksaan",
      url: SEPUTAR_JAMINAN_URLS.review,
      icon: "lucide lucide-badge-check",
      order: 2,
    }),
    Object.freeze({
      name: "Profil & Kontak",
      url: SEPUTAR_JAMINAN_URLS.profileContact,
      icon: "lucide lucide-building-2",
      order: 3,
    }),
  ]),
});

const SEPUTAR_JAMINAN_ADMIN_POLICIES = Object.freeze([
  Object.freeze({
    url: SEPUTAR_JAMINAN_URLS.root,
    permissions: Object.freeze(["create", "read", "update", "delete"]),
    features: Object.freeze([
      SJ_REVIEW_FEATURE,
      SJ_PUBLISH_FEATURE,
      SJ_UNPUBLISH_FEATURE,
      SJ_ARCHIVE_FEATURE,
      SJ_RECONFIRM_FEATURE,
      SJ_CONTACT_VERIFY_FEATURE,
      SJ_PROFILE_VERIFY_FEATURE,
      SJ_SYNC_RETRY_FEATURE,
      SJ_MANAGE_ALL_FEATURE,
    ]),
  }),
  Object.freeze({
    url: SEPUTAR_JAMINAN_URLS.catalog,
    permissions: Object.freeze(["create", "read", "update", "delete"]),
  }),
  Object.freeze({
    url: SEPUTAR_JAMINAN_URLS.review,
    permissions: Object.freeze(["read", "update"]),
  }),
  Object.freeze({
    url: SEPUTAR_JAMINAN_URLS.profileContact,
    permissions: Object.freeze(["create", "read", "update", "delete"]),
  }),
]);

module.exports = {
  SEPUTAR_JAMINAN_ADMIN_POLICIES,
  SEPUTAR_JAMINAN_MENU_TREE,
  SEPUTAR_JAMINAN_URLS,
};
