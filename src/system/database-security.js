function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase(),
  );
}

const MANDATORY_RLS_TABLES = Object.freeze([
  "auth_action_tokens",
  "debtor_activity_logs",
  "debtor_collaterals",
  "debtor_collectibilities",
  "debtor_contract_slik_snapshots",
  "debtor_contracts",
  "debtor_document_files",
  "debtor_documents",
  "debtor_external_records",
  "debtor_ideb_upload_files",
  "debtor_ideb_uploads",
  "debtor_import_jobs",
  "debtor_import_segments",
  "debtor_individual_profiles",
  "debtor_legal_entity_profiles",
  "debtor_marketing_activities",
  "debtor_marketing_activity_files",
  "debtor_marketing_timelines",
  "debtor_slik_records",
  "debtor_warning_letter_files",
  "debtor_warning_letters",
  "digital_debtors",
  "digital_document_access_requests",
  "digital_document_loans",
  "digital_document_related_users",
  "digital_documents",
  "document_files",
  "incoming_mail_dispositions",
  "incoming_mail_target_divisions",
  "incoming_mails",
  "legal_activity_logs",
  "legal_claim_files",
  "legal_claims",
  "legal_deposit_transaction_files",
  "legal_deposit_transactions",
  "legal_deposits",
  "legal_insurance_progress",
  "legal_insurance_progress_files",
  "legal_kjpp_progress",
  "legal_kjpp_progress_files",
  "legal_notary_progress",
  "legal_notary_progress_files",
  "legal_print_histories",
  "legal_print_history_files",
  "memorandum_dispositions",
  "memorandum_target_divisions",
  "memorandums",
  "notifications",
  "outgoing_mails",
  "refresh_tokens",
  "storage_activity_logs",
  "system_activity_logs",
]);

const RLS_TABLE_EXEMPTIONS = Object.freeze({
  branches: "shared_reference",
  collateral_types: "shared_reference",
  collectibility_levels: "shared_reference",
  contract_types: "shared_reference",
  deposit_types: "shared_reference",
  divisions: "identity_and_rbac_directory",
  document_checklists: "shared_reference",
  document_types: "shared_reference",
  financing_products: "shared_reference",
  legal_document_template_files: "shared_legal_template",
  legal_document_templates: "shared_legal_template",
  legal_process_types: "shared_reference",
  letter_priorities: "shared_reference",
  mail_delivery_media: "shared_reference",
  menus: "identity_and_rbac_directory",
  numbering_templates: "shared_reference",
  role_menus: "identity_and_rbac_directory",
  roles: "identity_and_rbac_directory",
  storage_cabinets: "shared_storage_catalog",
  storage_offices: "shared_storage_catalog",
  storage_usage_configs: "shared_storage_configuration",
  storage_usage_daily_snapshots: "shared_storage_metrics",
  storages: "shared_storage_catalog",
  third_parties: "shared_reference",
  users: "identity_and_rbac_directory",
  watermark_settings: "shared_storage_configuration",
});

async function inspectDatabaseSecurity(prismaClient) {
  const [role] = await prismaClient.$queryRawUnsafe(`
    SELECT
      current_user AS role_name,
      role_data.rolsuper AS is_superuser,
      role_data.rolbypassrls AS bypasses_rls,
      role_data.rolcreaterole AS can_create_role,
      role_data.rolcreatedb AS can_create_database
    FROM pg_roles role_data
    WHERE role_data.rolname = current_user
  `);
  const [rls] = await prismaClient.$queryRawUnsafe(`
    SELECT
      COUNT(*) FILTER (WHERE relation.relrowsecurity)::int AS rls_enabled_tables,
      COUNT(*) FILTER (WHERE relation.relforcerowsecurity)::int AS rls_forced_tables,
      (SELECT COUNT(*)::int FROM pg_policies WHERE schemaname = 'public') AS policy_count
    FROM pg_class relation
    JOIN pg_namespace namespace_data ON namespace_data.oid = relation.relnamespace
    WHERE namespace_data.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
  `);
  const [publicAccess] = await prismaClient.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*)::int
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND grantee = 'PUBLIC') AS table_grants,
      (SELECT COUNT(*)::int
         FROM pg_namespace namespace_data,
              LATERAL aclexplode(
                COALESCE(
                  namespace_data.nspacl,
                  acldefault('n', namespace_data.nspowner)
                )
              ) access_entry
        WHERE namespace_data.nspname = 'public'
          AND access_entry.grantee = 0) AS schema_grants
  `);
  const rlsTables = await prismaClient.$queryRawUnsafe(`
    SELECT
      relation.relname AS table_name,
      relation.relrowsecurity AS rls_enabled,
      relation.relforcerowsecurity AS rls_forced,
      COUNT(policy.policyname)::int AS policy_count
    FROM pg_class relation
    JOIN pg_namespace namespace_data ON namespace_data.oid = relation.relnamespace
    LEFT JOIN pg_policies policy
      ON policy.schemaname = namespace_data.nspname
     AND policy.tablename = relation.relname
    WHERE namespace_data.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
    GROUP BY relation.relname, relation.relrowsecurity, relation.relforcerowsecurity
    HAVING relation.relrowsecurity OR COUNT(policy.policyname) > 0
    ORDER BY relation.relname
  `);
  const applicationTables = await prismaClient.$queryRawUnsafe(`
    SELECT relation.relname AS table_name
    FROM pg_class relation
    JOIN pg_namespace namespace_data ON namespace_data.oid = relation.relnamespace
    WHERE namespace_data.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname <> '_prisma_migrations'
    ORDER BY relation.relname
  `);
  const [policyRole] = await prismaClient.$queryRawUnsafe(`
    SELECT
      role_data.rolcanlogin AS can_login,
      role_data.rolsuper AS is_superuser,
      role_data.rolbypassrls AS bypasses_rls,
      role_data.rolcreaterole AS can_create_role,
      role_data.rolcreatedb AS can_create_database
    FROM pg_roles role_data
    WHERE role_data.rolname = 'ruwang_arsip_policy'
  `);
  const [helperSecurity] = await prismaClient.$queryRawUnsafe(`
    SELECT
      COUNT(*) FILTER (
        WHERE helper.prosecdef
          AND (
            owner_role.rolname <> 'ruwang_arsip_policy'
            OR helper.proconfig IS NULL
            OR NOT ('search_path=pg_catalog, public' = ANY(helper.proconfig))
          )
      )::int AS unsafe_security_definer_count,
      COUNT(*) FILTER (
        WHERE has_function_privilege('public', helper.oid, 'EXECUTE')
      )::int AS public_execute_count,
      COUNT(*) FILTER (
        WHERE NOT has_function_privilege(current_user, helper.oid, 'EXECUTE')
      )::int AS missing_runtime_execute_count
    FROM pg_proc helper
    JOIN pg_namespace namespace_data ON namespace_data.oid = helper.pronamespace
    JOIN pg_roles owner_role ON owner_role.oid = helper.proowner
    WHERE namespace_data.nspname = 'public'
      AND helper.proname LIKE 'ruwang_arsip_%'
  `);

  return {
    role_name: role?.role_name || null,
    is_superuser: Boolean(role?.is_superuser),
    bypasses_rls: Boolean(role?.bypasses_rls),
    can_create_role: Boolean(role?.can_create_role),
    can_create_database: Boolean(role?.can_create_database),
    rls_enabled_tables: Number(rls?.rls_enabled_tables || 0),
    rls_forced_tables: Number(rls?.rls_forced_tables || 0),
    policy_count: Number(rls?.policy_count || 0),
    public_table_grants: Number(publicAccess?.table_grants || 0),
    public_schema_grants: Number(publicAccess?.schema_grants || 0),
    rls_tables: rlsTables.map((item) => ({
      table_name: item.table_name,
      rls_enabled: Boolean(item.rls_enabled),
      rls_forced: Boolean(item.rls_forced),
      policy_count: Number(item.policy_count || 0),
    })),
    application_tables: applicationTables.map((item) => item.table_name),
    policy_role: policyRole
      ? {
          can_login: Boolean(policyRole.can_login),
          is_superuser: Boolean(policyRole.is_superuser),
          bypasses_rls: Boolean(policyRole.bypasses_rls),
          can_create_role: Boolean(policyRole.can_create_role),
          can_create_database: Boolean(policyRole.can_create_database),
        }
      : null,
    rls_helper_security: {
      unsafe_security_definer_count: Number(
        helperSecurity?.unsafe_security_definer_count || 0,
      ),
      public_execute_count: Number(helperSecurity?.public_execute_count || 0),
      missing_runtime_execute_count: Number(
        helperSecurity?.missing_runtime_execute_count || 0,
      ),
    },
  };
}

function parseRequiredRlsTables(value) {
  const configured = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set([...MANDATORY_RLS_TABLES, ...configured])];
}

function evaluateDatabaseSecurity(
  report,
  {
    expectedRole = process.env.DATABASE_RUNTIME_ROLE || null,
    requireLeastPrivilege = readBoolean(
      process.env.DB_REQUIRE_LEAST_PRIVILEGE,
      process.env.NODE_ENV === "production",
    ),
    requireRls = readBoolean(process.env.DB_REQUIRE_RLS, false),
    requiredRlsTables = parseRequiredRlsTables(
      process.env.DB_RLS_REQUIRED_TABLES,
    ),
  } = {},
) {
  const failures = [];
  if (requireLeastPrivilege && report.is_superuser) failures.push("superuser");
  if (requireLeastPrivilege && report.bypasses_rls) failures.push("bypass_rls");
  if (requireLeastPrivilege && report.can_create_role) failures.push("create_role");
  if (requireLeastPrivilege && report.can_create_database) {
    failures.push("create_database");
  }
  if (requireLeastPrivilege && report.public_table_grants > 0) {
    failures.push("public_table_grants");
  }
  if (requireLeastPrivilege && report.public_schema_grants > 0) {
    failures.push("public_schema_grants");
  }
  if (expectedRole && report.role_name !== expectedRole) {
    failures.push("unexpected_runtime_role");
  }
  if (requireRls) {
    const tableReports = new Map(
      (report.rls_tables || []).map((item) => [item.table_name, item]),
    );
    for (const tableName of requiredRlsTables) {
      const table = tableReports.get(tableName);
      if (!table?.rls_enabled) failures.push(`rls_disabled:${tableName}`);
      if (!table?.rls_forced) failures.push(`rls_not_forced:${tableName}`);
      if (!table || table.policy_count < 1) {
        failures.push(`rls_policy_missing:${tableName}`);
      }
    }
    const classifiedTables = new Set([
      ...requiredRlsTables,
      ...Object.keys(RLS_TABLE_EXEMPTIONS),
    ]);
    for (const tableName of report.application_tables || []) {
      if (!classifiedTables.has(tableName)) {
        failures.push(`rls_table_unclassified:${tableName}`);
      }
    }
    if (!report.policy_role) failures.push("rls_policy_role_missing");
    if (report.policy_role?.can_login) failures.push("rls_policy_role_can_login");
    if (report.policy_role?.is_superuser) failures.push("rls_policy_role_superuser");
    if (report.policy_role && !report.policy_role.bypasses_rls) {
      failures.push("rls_policy_role_missing_bypass");
    }
    if (report.policy_role?.can_create_role) {
      failures.push("rls_policy_role_create_role");
    }
    if (report.policy_role?.can_create_database) {
      failures.push("rls_policy_role_create_database");
    }
    if (report.rls_helper_security?.unsafe_security_definer_count > 0) {
      failures.push("rls_helper_unsafe_security_definer");
    }
    if (report.rls_helper_security?.public_execute_count > 0) {
      failures.push("rls_helper_public_execute");
    }
    if (report.rls_helper_security?.missing_runtime_execute_count > 0) {
      failures.push("rls_helper_runtime_execute_missing");
    }
  }

  return {
    healthy: failures.length === 0,
    failures,
    enforcement: {
      least_privilege_required: requireLeastPrivilege,
      rls_required: requireRls,
      expected_role_configured: Boolean(expectedRole),
      required_rls_tables: requireRls ? requiredRlsTables : [],
    },
  };
}

function evaluateDatabaseSystemSecurity(
  report,
  {
    expectedRole = process.env.DATABASE_SYSTEM_ROLE || null,
    requireBypassRls = readBoolean(process.env.DB_REQUIRE_RLS, false),
  } = {},
) {
  const failures = [];
  if (report.is_superuser) failures.push("system_superuser");
  if (report.can_create_role) failures.push("system_create_role");
  if (report.can_create_database) failures.push("system_create_database");
  if (requireBypassRls && !report.bypasses_rls) {
    failures.push("system_missing_bypass_rls");
  }
  if (expectedRole && report.role_name !== expectedRole) {
    failures.push("unexpected_system_role");
  }
  return { healthy: failures.length === 0, failures };
}

async function assertDatabaseSystemSecurity(prismaClient, options) {
  const report = await inspectDatabaseSecurity(prismaClient);
  const evaluation = evaluateDatabaseSystemSecurity(report, options);
  if (!evaluation.healthy) {
    throw new Error(
      `Konfigurasi role database sistem tidak aman: ${evaluation.failures.join(", ")}.`,
    );
  }
  return { report, evaluation };
}

async function assertDatabaseRuntimeSecurity(prismaClient, options) {
  const report = await inspectDatabaseSecurity(prismaClient);
  const evaluation = evaluateDatabaseSecurity(report, options);
  if (!evaluation.healthy) {
    throw new Error(
      `Konfigurasi role database tidak aman: ${evaluation.failures.join(", ")}.`,
    );
  }
  return { report, evaluation };
}

async function assertDatabaseWorkerSecurity(
  prismaClient,
  { usesSystemDatabase = false } = {},
) {
  if (usesSystemDatabase) {
    return assertDatabaseSystemSecurity(prismaClient);
  }
  return assertDatabaseRuntimeSecurity(prismaClient);
}

function safeDatabaseSecuritySummary(report, evaluation) {
  return {
    enforcement_healthy: evaluation.healthy,
    least_privilege_required:
      evaluation.enforcement.least_privilege_required,
    is_superuser: report.is_superuser,
    bypasses_rls: report.bypasses_rls,
    public_table_grants: report.public_table_grants,
    public_schema_grants: report.public_schema_grants,
    rls_enabled_tables: report.rls_enabled_tables,
    rls_forced_tables: report.rls_forced_tables,
    rls_policy_count: report.policy_count,
    rls_enforcement_required: evaluation.enforcement.rls_required,
    required_rls_tables: evaluation.enforcement.required_rls_tables,
    rls_exempt_tables: Object.keys(RLS_TABLE_EXEMPTIONS),
    rls_policy_role_healthy:
      Boolean(report.policy_role) &&
      !report.policy_role.can_login &&
      !report.policy_role.is_superuser &&
      report.policy_role.bypasses_rls &&
      !report.policy_role.can_create_role &&
      !report.policy_role.can_create_database,
    rls_helper_security: report.rls_helper_security,
  };
}

module.exports = {
  MANDATORY_RLS_TABLES,
  RLS_TABLE_EXEMPTIONS,
  assertDatabaseRuntimeSecurity,
  assertDatabaseSystemSecurity,
  assertDatabaseWorkerSecurity,
  evaluateDatabaseSecurity,
  evaluateDatabaseSystemSecurity,
  inspectDatabaseSecurity,
  parseRequiredRlsTables,
  safeDatabaseSecuritySummary,
};
