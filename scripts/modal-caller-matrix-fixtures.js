const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadEnv } = require("../src/config/env");

loadEnv();

const prisma = require("../src/config/prisma-system");
const {
  assertSafeIntegrationDatabase,
  readAdminCredentials,
} = require("../src/integration/support/integration-test-helpers");
const { hashPassword } = require("../src/utils/bcrypt");

const FIXTURE_KIND = "ruwang-arsip-modal-caller-matrix";
const FIXTURE_VERSION = 1;
const MANIFEST_PATH = path.join(os.tmpdir(), `${FIXTURE_KIND}.json`);

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (
    manifest?.kind !== FIXTURE_KIND ||
    manifest?.version !== FIXTURE_VERSION ||
    !manifest?.database ||
    !manifest?.user?.id ||
    !manifest?.user?.username
  ) {
    throw new Error("Manifest fixture matriks modal tidak dikenali.");
  }
  return manifest;
}

function writeManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

async function setup() {
  const database = assertSafeIntegrationDatabase(
    "Modal caller matrix fixture setup",
  );
  if (readManifest()) {
    throw new Error(
      `Fixture matriks modal masih aktif. Jalankan cleanup: ${MANIFEST_PATH}`,
    );
  }

  const credentials = readAdminCredentials();
  const admin = await prisma.users.findUnique({
    where: { username: credentials.username.toLowerCase() },
    select: { division_id: true },
  });
  const staffRole = await prisma.roles.findUnique({
    where: { name: "Staf" },
    select: { id: true },
  });
  if (!admin?.division_id || !staffRole?.id) {
    throw new Error("Admin dengan divisi dan role Staf wajib tersedia.");
  }

  const runId = crypto.randomUUID();
  const suffix = runId.replace(/-/g, "").slice(0, 12);
  const username = `modal_matrix_${suffix}`;
  const user = await prisma.users.create({
    data: {
      id: crypto.randomUUID(),
      name: `Pengguna Bersih Modal ${suffix}`,
      username,
      email: `${username}@integration.invalid`,
      password: await hashPassword(`Modal-Matrix-${suffix}-123!`),
      role_id: staffRole.id,
      division_id: admin.division_id,
      is_active: true,
      onboarding_status: "ACTIVE",
      email_verified_at: new Date(),
      password_set_at: new Date(),
      activated_at: new Date(),
    },
  });

  writeManifest({
    kind: FIXTURE_KIND,
    version: FIXTURE_VERSION,
    runId,
    createdAt: new Date().toISOString(),
    database,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
    },
  });

  console.log(
    JSON.stringify({
      status: "created",
      manifest: MANIFEST_PATH,
      user: { id: user.id, username: user.username },
    }),
  );
}

async function cleanup() {
  const database = assertSafeIntegrationDatabase(
    "Modal caller matrix fixture cleanup",
  );
  const manifest = readManifest();
  if (!manifest) {
    console.log(JSON.stringify({ status: "absent", manifest: MANIFEST_PATH }));
    return;
  }
  if (
    manifest.database.databaseName !== database.databaseName ||
    manifest.database.hostname !== database.hostname
  ) {
    throw new Error("Database aktif berbeda dari manifest fixture matriks modal.");
  }

  const deleted = await prisma.users.deleteMany({
    where: {
      id: manifest.user.id,
      email: manifest.user.email,
      AND: [
        { username: manifest.user.username },
        { username: { startsWith: "modal_matrix_" } },
      ],
    },
  });
  if (deleted.count !== 1) {
    throw new Error(
      `Cleanup fixture matriks modal mengharapkan 1 user, ditemukan ${deleted.count}.`,
    );
  }

  fs.rmSync(MANIFEST_PATH, { force: true });
  console.log(JSON.stringify({ status: "cleaned", deleted_users: 1 }));
}

async function status() {
  const database = assertSafeIntegrationDatabase(
    "Modal caller matrix fixture status",
  );
  const manifest = readManifest();
  if (!manifest) {
    console.log(JSON.stringify({ status: "absent", manifest: MANIFEST_PATH }));
    return;
  }
  if (
    manifest.database.databaseName !== database.databaseName ||
    manifest.database.hostname !== database.hostname
  ) {
    throw new Error("Database aktif berbeda dari manifest fixture matriks modal.");
  }

  const count = await prisma.users.count({
    where: { id: manifest.user.id, username: manifest.user.username },
  });
  console.log(JSON.stringify({ status: "active", users: count }));
}

async function main() {
  const action = String(process.argv[2] || "status").trim().toLowerCase();
  if (action === "setup") return setup();
  if (action === "cleanup") return cleanup();
  if (action === "status") return status();
  throw new Error("Aksi fixture harus setup, cleanup, atau status.");
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
