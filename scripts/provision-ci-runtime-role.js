const { Client } = require("pg");

const CI_RUNTIME_ROLE = "ruwang_arsip_app";
const CI_SEPUTAR_JAMINAN_WORKER_ROLE = "ruwang_sj_worker";

function assertSafeCiMigrationDatabase(env = process.env) {
  if (String(env.CI || "").trim().toLowerCase() !== "true") {
    throw new Error("Provisioning role CI hanya boleh dijalankan saat CI=true.");
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(String(env.MIGRATION_DATABASE_URL || ""));
  } catch {
    throw new Error("MIGRATION_DATABASE_URL CI tidak valid.");
  }

  const hostname = databaseUrl.hostname.toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.startsWith("127.");
  const githubService =
    hostname === "postgres" &&
    String(env.GITHUB_ACTIONS || "").trim().toLowerCase() === "true";
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));

  if (
    (!loopback && !githubService) ||
    !/(?:^|[_-])(?:ci|test|local)(?:$|[_-])/i.test(databaseName)
  ) {
    throw new Error(
      "Provisioning role CI ditolak: database wajib loopback atau service PostgreSQL GitHub Actions dan namanya harus memuat penanda ci/test/local.",
    );
  }

  return { connectionString: databaseUrl.toString(), databaseName, hostname };
}

async function provisionCiRuntimeRole(env = process.env, ClientClass = Client) {
  const database = assertSafeCiMigrationDatabase(env);
  const client = new ClientClass({ connectionString: database.connectionString });

  await client.connect();
  try {
    await client.query(`
      DO $provision_ci_runtime_roles$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_roles WHERE rolname = '${CI_RUNTIME_ROLE}'
        ) THEN
          CREATE ROLE ${CI_RUNTIME_ROLE}
            NOLOGIN
            NOSUPERUSER
            NOBYPASSRLS
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_roles
          WHERE rolname = '${CI_SEPUTAR_JAMINAN_WORKER_ROLE}'
        ) THEN
          CREATE ROLE ${CI_SEPUTAR_JAMINAN_WORKER_ROLE}
            NOLOGIN
            NOSUPERUSER
            NOBYPASSRLS
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT;
        END IF;
      END
      $provision_ci_runtime_roles$;
    `);
  } finally {
    await client.end();
  }

  return {
    database_name: database.databaseName,
    runtime_role: CI_RUNTIME_ROLE,
    worker_role: CI_SEPUTAR_JAMINAN_WORKER_ROLE,
  };
}

async function main() {
  const result = await provisionCiRuntimeRole();
  console.log(JSON.stringify({ status: "passed", ...result }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        status: "failed",
        reason: error instanceof Error ? error.message : "unknown_error",
      }),
    );
    process.exitCode = 1;
  });
}

module.exports = {
  CI_RUNTIME_ROLE,
  CI_SEPUTAR_JAMINAN_WORKER_ROLE,
  assertSafeCiMigrationDatabase,
  provisionCiRuntimeRole,
};
