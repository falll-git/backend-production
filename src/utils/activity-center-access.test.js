const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ROLE_MENU_POLICIES,
} = require("../../prisma/seed/role_menus.seeder");

const ACTIVITY_CENTER_URL = "/dashboard/activity-centre";

function hasReadAccess(roleName) {
  return ROLE_MENU_POLICIES[roleName]?.some(
    (policy) =>
      policy.url === ACTIVITY_CENTER_URL &&
      policy.permissions?.includes("read"),
  );
}

test("Admin memiliki akses baca Pusat Log Aktivitas", () => {
  assert.equal(hasReadAccess("Admin"), true);
});

test("Manager memiliki akses baca Pusat Log Aktivitas", () => {
  assert.equal(hasReadAccess("Manager"), true);
});

test("akses Pusat Log Aktivitas tidak diberikan otomatis kepada Staf", () => {
  assert.equal(hasReadAccess("Staf"), false);
});
