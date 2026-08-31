const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MANDATORY_RLS_TABLES,
  RLS_TABLE_EXEMPTIONS,
  RUNTIME_CALLABLE_HELPER_PREDICATE,
  evaluateDatabaseSecurity,
  evaluateDatabaseSystemSecurity,
  parseRequiredRlsTables,
} = require("./database-security");

test("pemeriksaan izin runtime mengecualikan fungsi trigger internal", () => {
  assert.equal(
    RUNTIME_CALLABLE_HELPER_PREDICATE,
    "helper.prorettype <> 'pg_catalog.trigger'::regtype",
  );
});

function report(overrides = {}) {
  return {
    role_name: "ruwang_arsip_app",
    is_superuser: false,
    bypasses_rls: false,
    can_create_role: false,
    can_create_database: false,
    public_table_grants: 0,
    public_schema_grants: 0,
    policy_count: 0,
    rls_tables: [],
    policy_role: {
      can_login: false,
      is_superuser: false,
      bypasses_rls: true,
      can_create_role: false,
      can_create_database: false,
    },
      rls_helper_security: {
        unsafe_security_definer_count: 0,
        public_execute_count: 0,
        missing_runtime_execute_count: 0,
    },
    ...overrides,
  };
}

test("runtime production menolak superuser, BYPASSRLS, dan role yang salah", () => {
  const result = evaluateDatabaseSecurity(
    report({
      role_name: "postgres",
      is_superuser: true,
      bypasses_rls: true,
      can_create_role: true,
      can_create_database: true,
    }),
    {
      expectedRole: "ruwang_arsip_app",
      requireLeastPrivilege: true,
      requireRls: false,
    },
  );
  assert.equal(result.healthy, false);
  assert.deepEqual(result.failures, [
    "superuser",
    "bypass_rls",
    "create_role",
    "create_database",
    "unexpected_runtime_role",
  ]);
});

test("RLS memverifikasi enable, force, dan policy pada setiap tabel wajib", () => {
  assert.equal(
    evaluateDatabaseSecurity(report(), {
      expectedRole: "ruwang_arsip_app",
      requireLeastPrivilege: true,
      requireRls: false,
    }).healthy,
    true,
  );
  assert.deepEqual(
    evaluateDatabaseSecurity(report(), {
      expectedRole: "ruwang_arsip_app",
      requireLeastPrivilege: true,
      requireRls: true,
      requiredRlsTables: ["notifications"],
    }).failures,
    [
      "rls_disabled:notifications",
      "rls_not_forced:notifications",
      "rls_policy_missing:notifications",
    ],
  );

  assert.equal(
    evaluateDatabaseSecurity(
      report({
        rls_tables: [
          {
            table_name: "notifications",
            rls_enabled: true,
            rls_forced: true,
            policy_count: 1,
          },
        ],
      }),
      {
        expectedRole: "ruwang_arsip_app",
        requireLeastPrivilege: true,
        requireRls: true,
        requiredRlsTables: ["notifications"],
      },
    ).healthy,
    true,
  );
});

test("konfigurasi tidak dapat menghapus tabel RLS minimum", () => {
  const required = parseRequiredRlsTables("notifications,custom_table");
  assert.deepEqual(required.slice(0, -1), MANDATORY_RLS_TABLES);
  assert.equal(required.at(-1), "custom_table");
});

test("tabel baru wajib masuk daftar RLS atau pengecualian eksplisit", () => {
  const result = evaluateDatabaseSecurity(
    report({ application_tables: ["notifications", "new_sensitive_table"] }),
    {
      requireLeastPrivilege: false,
      requireRls: true,
      requiredRlsTables: ["notifications"],
    },
  );

  assert.ok(Object.keys(RLS_TABLE_EXEMPTIONS).includes("users"));
  assert.ok(result.failures.includes("rls_table_unclassified:new_sensitive_table"));
});

test("RLS menolak role policy atau helper SECURITY DEFINER yang melebar", () => {
  const result = evaluateDatabaseSecurity(
    report({
      policy_role: {
        can_login: true,
        is_superuser: false,
        bypasses_rls: false,
        can_create_role: true,
        can_create_database: false,
      },
      rls_helper_security: {
        unsafe_security_definer_count: 1,
        public_execute_count: 2,
        missing_runtime_execute_count: 3,
      },
    }),
    { requireLeastPrivilege: false, requireRls: true, requiredRlsTables: [] },
  );

  for (const failure of [
    "rls_policy_role_can_login",
    "rls_policy_role_missing_bypass",
    "rls_policy_role_create_role",
    "rls_helper_unsafe_security_definer",
    "rls_helper_public_execute",
    "rls_helper_runtime_execute_missing",
  ]) {
    assert.ok(result.failures.includes(failure));
  }
});

test("role sistem wajib BYPASSRLS tetapi tetap bukan superuser", () => {
  assert.equal(
    evaluateDatabaseSystemSecurity(
      report({
        role_name: "ruwang_arsip_system",
        bypasses_rls: true,
      }),
      {
        expectedRole: "ruwang_arsip_system",
        requireBypassRls: true,
      },
    ).healthy,
    true,
  );

  assert.deepEqual(
    evaluateDatabaseSystemSecurity(
      report({ role_name: "postgres", is_superuser: true }),
      {
        expectedRole: "ruwang_arsip_system",
        requireBypassRls: true,
      },
    ).failures,
    ["system_superuser", "system_missing_bypass_rls", "unexpected_system_role"],
  );
});
