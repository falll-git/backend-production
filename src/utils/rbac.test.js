const test = require("node:test");
const assert = require("node:assert/strict");

const { rolePermissionsCover } = require("./rbac");

function permission(overrides = {}) {
  return {
    menu_id: "menu-1",
    can_create: false,
    can_read: true,
    can_update: false,
    can_delete: false,
    features: [],
    ...overrides,
  };
}

test("role yang lebih kuat dapat memberikan role yang lebih terbatas", () => {
  assert.equal(
    rolePermissionsCover(
      [
        permission({
          can_create: true,
          can_update: true,
          features: ["view_division", "manage_all"],
        }),
      ],
      [permission({ can_create: true, features: ["view_division"] })],
    ),
    true,
  );
});

test("role tidak dapat memberikan capability yang tidak dimilikinya", () => {
  assert.equal(
    rolePermissionsCover(
      [permission()],
      [permission({ can_update: true })],
    ),
    false,
  );
});

test("role tidak dapat memberikan fitur yang tidak dimilikinya", () => {
  assert.equal(
    rolePermissionsCover(
      [permission({ features: ["view_division"] })],
      [permission({ features: ["manage_all"] })],
    ),
    false,
  );
});

test("izin target pada menu lain juga harus dimiliki pemberi role", () => {
  assert.equal(
    rolePermissionsCover(
      [permission()],
      [permission({ menu_id: "menu-2" })],
    ),
    false,
  );
});
