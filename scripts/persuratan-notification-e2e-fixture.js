const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");

const { loadEnv } = require("../src/config/env");

loadEnv();

// Cross-scope fixture lifecycle uses the dedicated non-superuser system role.
// The memorandum itself is still created through the authenticated API so the
// application/RLS path remains part of the browser contract.
const prisma = require("../src/config/prisma-system");
const {
  assertSafeIntegrationDatabase,
  loginAgent,
  readAdminCredentials,
} = require("../src/integration/support/integration-test-helpers");
const { hashPassword } = require("../src/utils/bcrypt");
const { deleteStoredFile } = require("../src/utils/persuratan-files");

const FIXTURE_KIND = "ruwang-arsip-persuratan-notification-e2e";
const FIXTURE_VERSION = 1;
const MANIFEST_PATH = path.join(os.tmpdir(), `${FIXTURE_KIND}.json`);
const USER_AGENT = "RuwangArsipNotificationE2E/1.0";
const MEMORANDUM_MARKER_PREFIX = "NOTIF-E2E-";
const RECIPIENT_USERNAME_PREFIX = "notif_e2e_";
const RECIPIENT_EMAIL_SUFFIX = "@integration.invalid";
const DIVISION_NAME_PREFIX = "Divisi Notifikasi E2E ";

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (
    manifest?.kind !== FIXTURE_KIND ||
    manifest?.version !== FIXTURE_VERSION ||
    !manifest?.ids?.memorandum ||
    !manifest?.ids?.recipient ||
    !manifest?.ids?.division
  ) {
    throw new Error("Manifest fixture notifikasi persuratan tidak dikenali.");
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

function loadPdfFixture(filePath) {
  const resolved = path.resolve(filePath);
  if (path.extname(resolved).toLowerCase() !== ".pdf") {
    throw new Error("Fixture notifikasi membutuhkan file PDF yang valid.");
  }

  let descriptor;
  try {
    descriptor = fs.openSync(resolved, "r");
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new Error("Fixture notifikasi membutuhkan file PDF yang valid.");
    }

    const buffer = fs.readFileSync(descriptor);
    if (buffer.subarray(0, 4).toString("utf8") !== "%PDF") {
      throw new Error("File fixture tidak memiliki signature PDF.");
    }
    return { buffer, name: path.basename(resolved), path: resolved };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function createSyntheticPdfFixture(runId) {
  return {
    buffer: Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
      "utf8",
    ),
    name: `${FIXTURE_KIND}-${runId}.pdf`,
    path: null,
    temporary: false,
  };
}

function resolvePdf(runId) {
  const configured = String(process.env.PERSURATAN_E2E_PDF_PATH || "").trim();
  if (configured) {
    return { ...loadPdfFixture(configured), temporary: false };
  }
  return createSyntheticPdfFixture(runId);
}

async function findBaseline() {
  const credentials = readAdminCredentials();
  const admin = await prisma.users.findUnique({
    where: { username: credentials.username.toLowerCase() },
  });
  const [storage, managerRole] = await Promise.all([
    prisma.storages.findFirst({ where: { is_active: true } }),
    prisma.roles.findUnique({ where: { name: "Manager" } }),
  ]);
  if (!admin?.division_id || !storage || !managerRole) {
    throw new Error(
      "Admin dengan divisi, storage aktif, dan role Manager wajib tersedia.",
    );
  }
  return { admin, credentials, managerRole, storage };
}

async function findStaleFixtureRecords() {
  const [memorandums, recipients, divisions] = await Promise.all([
    prisma.memorandums.findMany({
      where: { memo_number: { startsWith: MEMORANDUM_MARKER_PREFIX } },
      select: { id: true, file: true },
    }),
    prisma.users.findMany({
      where: {
        username: { startsWith: RECIPIENT_USERNAME_PREFIX },
        email: { endsWith: RECIPIENT_EMAIL_SUFFIX },
      },
      select: { id: true },
    }),
    prisma.divisions.findMany({
      where: { name: { startsWith: DIVISION_NAME_PREFIX } },
      select: { id: true },
    }),
  ]);
  const memorandumIds = memorandums.map((item) => item.id);
  const dispositions =
    memorandumIds.length > 0
      ? await prisma.memorandum_dispositions.findMany({
          where: { memorandums_id: { in: memorandumIds } },
          select: { id: true },
        })
      : [];

  return {
    divisionIds: divisions.map((item) => item.id),
    dispositionIds: dispositions.map((item) => item.id),
    memorandumIds,
    recipientIds: recipients.map((item) => item.id),
    storedPaths: memorandums.map((item) => item.file).filter(Boolean),
  };
}

function fixtureRecordCounts(records) {
  return {
    divisions: records.divisionIds.length,
    dispositions: records.dispositionIds.length,
    memorandums: records.memorandumIds.length,
    recipients: records.recipientIds.length,
  };
}

function hasFixtureRecords(records) {
  return Object.values(fixtureRecordCounts(records)).some((count) => count > 0);
}

async function cleanupStaleFixtureRecords() {
  const stale = await findStaleFixtureRecords();
  if (!hasFixtureRecords(stale)) {
    return { deleted: null, remaining: fixtureRecordCounts(stale), status: "absent" };
  }

  const entityIds = [...stale.memorandumIds, ...stale.dispositionIds];
  const deleted = await prisma.$transaction(async (tx) => {
    const notificationFilters = [
      ...(stale.recipientIds.length > 0
        ? [{ recipient_id: { in: stale.recipientIds } }]
        : []),
      ...(entityIds.length > 0 ? [{ entity_id: { in: entityIds } }] : []),
    ];
    const notifications =
      notificationFilters.length > 0
        ? await tx.notifications.deleteMany({
            where: { OR: notificationFilters },
          })
        : { count: 0 };
    const activities = await tx.system_activity_logs.deleteMany({
      where: {
        OR: [
          { user_agent: USER_AGENT },
          ...(stale.recipientIds.length > 0
            ? [{ actor_id: { in: stale.recipientIds } }]
            : []),
          ...(entityIds.length > 0 ? [{ entity_id: { in: entityIds } }] : []),
        ],
      },
    });
    const refreshTokens =
      stale.recipientIds.length > 0
        ? await tx.refresh_tokens.deleteMany({
            where: { user_id: { in: stale.recipientIds } },
          })
        : { count: 0 };
    const memorandums =
      stale.memorandumIds.length > 0
        ? await tx.memorandums.deleteMany({
            where: {
              id: { in: stale.memorandumIds },
              memo_number: { startsWith: MEMORANDUM_MARKER_PREFIX },
            },
          })
        : { count: 0 };
    const recipients =
      stale.recipientIds.length > 0
        ? await tx.users.deleteMany({
            where: {
              id: { in: stale.recipientIds },
              username: { startsWith: RECIPIENT_USERNAME_PREFIX },
              email: { endsWith: RECIPIENT_EMAIL_SUFFIX },
            },
          })
        : { count: 0 };
    const divisions =
      stale.divisionIds.length > 0
        ? await tx.divisions.deleteMany({
            where: {
              id: { in: stale.divisionIds },
              name: { startsWith: DIVISION_NAME_PREFIX },
            },
          })
        : { count: 0 };

    return {
      activities: activities.count,
      divisions: divisions.count,
      memorandums: memorandums.count,
      notifications: notifications.count,
      recipients: recipients.count,
      refreshTokens: refreshTokens.count,
    };
  });

  for (const storedPath of stale.storedPaths) deleteStoredFile(storedPath);
  for (const entry of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
    if (
      entry.isFile() &&
      entry.name.startsWith(`${FIXTURE_KIND}-`) &&
      entry.name.endsWith(".pdf")
    ) {
      fs.rmSync(path.join(os.tmpdir(), entry.name), { force: true });
    }
  }

  const remainingRecords = await findStaleFixtureRecords();
  const remaining = fixtureRecordCounts(remainingRecords);
  if (hasFixtureRecords(remainingRecords)) {
    throw new Error(
      `Cleanup stale fixture notifikasi belum tuntas: ${JSON.stringify(remaining)}`,
    );
  }

  return { deleted, remaining, status: "cleaned_stale" };
}

async function setup() {
  const database = assertSafeIntegrationDatabase(
    "Persuratan notification E2E fixture setup",
  );
  if (readManifest()) {
    throw new Error(
      `Fixture notifikasi masih aktif. Jalankan cleanup: ${MANIFEST_PATH}`,
    );
  }
  const stale = await findStaleFixtureRecords();
  if (hasFixtureRecords(stale)) {
    throw new Error(
      "Fixture notifikasi lama masih tertinggal. Jalankan cleanup sebelum setup baru.",
    );
  }

  const baseline = await findBaseline();
  const runId = crypto.randomUUID();
  const suffix = runId.replace(/-/g, "").slice(0, 12);
  const marker = `NOTIF-E2E-${suffix}`;
  const password = `Notif-E2E-${suffix}-123!`;
  const pdf = resolvePdf(runId);
  let division;
  let recipient;
  let memorandum;

  try {
    division = await prisma.divisions.create({
      data: { name: `Divisi Notifikasi E2E ${suffix}` },
    });
    recipient = await prisma.users.create({
      data: {
        name: `Penerima Notifikasi E2E ${suffix}`,
        username: `notif_e2e_${suffix}`,
        email: `notif_e2e_${suffix}@integration.invalid`,
        password: await hashPassword(password),
        role_id: baseline.managerRole.id,
        division_id: division.id,
        is_active: true,
        onboarding_status: "ACTIVE",
        email_verified_at: new Date(),
        password_set_at: new Date(),
        activated_at: new Date(),
      },
    });

    const app = require("../src/app");
    const adminAgent = request.agent(app);
    const adminLogin = await loginAgent(
      adminAgent,
      baseline.credentials,
      USER_AGENT,
    );
    const now = new Date().toISOString();
    const response = await adminAgent
      .post("/api/v1/memorandums/with-disposition")
      .set("User-Agent", USER_AGENT)
      .set(adminLogin.authorization)
      .field("origin_division_id", baseline.admin.division_id)
      .field("storage_id", baseline.storage.id)
      .field("target_division_ids", JSON.stringify([division.id]))
      .field("memo_number", marker)
      .field("memo_date", now)
      .field("received_date", now)
      .field("regarding", `Pembuktian notifikasi menuju detail ${suffix}`)
      .field(
        "description",
        "Dokumen uji lokal untuk membuktikan klik notifikasi membuka modal detail yang tepat.",
      )
      .field("note", "Tindak lanjut notifikasi E2E")
      .attach("file", pdf.buffer, {
        contentType: "application/pdf",
        filename: pdf.name,
      })
      .expect(201);

    memorandum = response.body.data;
    const disposition = memorandum.dispositions?.find(
      (item) => item.receiver_id === recipient.id,
    );
    if (!disposition) {
      throw new Error("Disposisi awal untuk penerima fixture tidak terbentuk.");
    }
    const notification = await prisma.notifications.findFirst({
      where: {
        recipient_id: recipient.id,
        entity_id: disposition.id,
        link_url: `/dashboard/manajemen-surat/laporan?kind=memorandum&id=${memorandum.id}`,
      },
      orderBy: { created_at: "desc" },
    });
    if (!notification) {
      throw new Error("Notifikasi memorandum fixture tidak terbentuk.");
    }

    await adminAgent
      .post("/api/v1/auth/logout")
      .set("User-Agent", USER_AGENT)
      .set("Authorization", `Bearer ${adminLogin.accessToken}`)
      .catch(() => {});

    writeManifest({
      kind: FIXTURE_KIND,
      version: FIXTURE_VERSION,
      runId,
      marker,
      createdAt: new Date().toISOString(),
      database,
      sourcePdf: {
        name: pdf.name,
        temporary: pdf.temporary,
        path: pdf.temporary ? pdf.path : null,
      },
      credentials: {
        username: recipient.username,
        password,
      },
      records: {
        memorandumId: memorandum.id,
        memorandumNumber: marker,
        notificationTitle: notification.title,
        notificationMessage: notification.message,
      },
      ids: {
        division: division.id,
        recipient: recipient.id,
        memorandum: memorandum.id,
        disposition: disposition.id,
        notification: notification.id,
      },
      storedPath: memorandum.file_path,
    });

    console.log(
      JSON.stringify({
        status: "created",
        manifest: MANIFEST_PATH,
        source_pdf: pdf.name,
      }),
    );
  } catch (error) {
    if (memorandum?.id) {
      await prisma.$transaction(async (tx) => {
        const dispositionIds = await tx.memorandum_dispositions.findMany({
          where: { memorandums_id: memorandum.id },
          select: { id: true },
        });
        const entityIds = [
          memorandum.id,
          ...dispositionIds.map((item) => item.id),
        ];
        await tx.notifications.deleteMany({
          where: {
            OR: [
              { recipient_id: recipient?.id || "" },
              { entity_id: { in: entityIds } },
            ],
          },
        });
        await tx.system_activity_logs.deleteMany({
          where: {
            OR: [
              { actor_id: recipient?.id || "" },
              { entity_id: { in: entityIds } },
              { user_agent: USER_AGENT },
            ],
          },
        });
        await tx.memorandums.deleteMany({ where: { id: memorandum.id } });
      });
      deleteStoredFile(memorandum.file_path);
    }
    if (recipient?.id) {
      await prisma.users.deleteMany({ where: { id: recipient.id } });
    }
    if (division?.id) {
      await prisma.divisions.deleteMany({ where: { id: division.id } });
    }
    if (pdf.temporary) fs.rmSync(pdf.path, { force: true });
    throw error;
  }
}

async function cleanup() {
  const database = assertSafeIntegrationDatabase(
    "Persuratan notification E2E fixture cleanup",
  );
  const manifest = readManifest();
  if (!manifest) {
    const staleCleanup = await cleanupStaleFixtureRecords();
    console.log(
      JSON.stringify({
        ...staleCleanup,
        manifest: MANIFEST_PATH,
      }),
    );
    return;
  }
  if (
    manifest.database.databaseName !== database.databaseName ||
    manifest.database.hostname !== database.hostname
  ) {
    throw new Error("Database fixture tidak sama dengan database aktif.");
  }

  const ids = manifest.ids;
  const deleted = await prisma.$transaction(async (tx) => {
    const notifications = await tx.notifications.deleteMany({
      where: {
        OR: [
          { id: ids.notification },
          { recipient_id: ids.recipient },
          { entity_id: { in: [ids.memorandum, ids.disposition] } },
        ],
      },
    });
    const activities = await tx.system_activity_logs.deleteMany({
      where: {
        OR: [
          { entity_id: { in: [ids.memorandum, ids.disposition] } },
          { actor_id: ids.recipient },
          { user_agent: USER_AGENT },
        ],
      },
    });
    const memorandum = await tx.memorandums.deleteMany({
      where: { id: ids.memorandum, memo_number: manifest.marker },
    });
    const recipient = await tx.users.deleteMany({
      where: {
        id: ids.recipient,
        username: { startsWith: "notif_e2e_" },
      },
    });
    const division = await tx.divisions.deleteMany({
      where: {
        id: ids.division,
        name: { startsWith: "Divisi Notifikasi E2E " },
      },
    });
    return {
      activities: activities.count,
      division: division.count,
      memorandum: memorandum.count,
      notifications: notifications.count,
      recipient: recipient.count,
    };
  });

  const [remainingMemorandum, remainingNotification, remainingRecipient, remainingDivision] =
    await Promise.all([
      prisma.memorandums.count({
        where: { id: ids.memorandum, memo_number: manifest.marker },
      }),
      prisma.notifications.count({ where: { id: ids.notification } }),
      prisma.users.count({ where: { id: ids.recipient } }),
      prisma.divisions.count({ where: { id: ids.division } }),
    ]);
  const remaining = {
    division: remainingDivision,
    memorandum: remainingMemorandum,
    notification: remainingNotification,
    recipient: remainingRecipient,
  };
  if (Object.values(remaining).some((count) => count !== 0)) {
    throw new Error(
      `Cleanup fixture notifikasi belum tuntas: ${JSON.stringify(remaining)}`,
    );
  }

  deleteStoredFile(manifest.storedPath);
  if (manifest.sourcePdf?.temporary && manifest.sourcePdf.path) {
    fs.rmSync(manifest.sourcePdf.path, { force: true });
  }
  fs.rmSync(MANIFEST_PATH, { force: true });
  const staleCleanup = await cleanupStaleFixtureRecords();
  console.log(
    JSON.stringify({ status: "cleaned", deleted, remaining, staleCleanup }),
  );
}

async function status() {
  assertSafeIntegrationDatabase("Persuratan notification E2E fixture status");
  const manifest = readManifest();
  if (!manifest) {
    const stale = await findStaleFixtureRecords();
    console.log(
      JSON.stringify({
        status: hasFixtureRecords(stale) ? "stale" : "absent",
        manifest: MANIFEST_PATH,
        records: fixtureRecordCounts(stale),
      }),
    );
    return;
  }
  const [memorandum, notification, recipient] = await Promise.all([
    prisma.memorandums.count({ where: { id: manifest.ids.memorandum } }),
    prisma.notifications.count({ where: { id: manifest.ids.notification } }),
    prisma.users.count({ where: { id: manifest.ids.recipient } }),
  ]);
  console.log(
    JSON.stringify({
      status: "active",
      records: { memorandum, notification, recipient },
    }),
  );
}

async function main() {
  const action = String(process.argv[2] || "status").trim().toLowerCase();
  if (action === "setup") return setup();
  if (action === "cleanup") return cleanup();
  if (action === "status") return status();
  throw new Error("Aksi fixture harus setup, cleanup, atau status.");
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      const { closeApplicationCache } = require("../src/system/application-cache");
      const { closeRateLimitStore } = require("../src/system/rate-limit-store");
      const { closeSlikImportQueue } = require("../src/queues/slik-import.queue");
      await Promise.allSettled([
        closeApplicationCache(),
        closeRateLimitStore(),
        closeSlikImportQueue(),
      ]);
      await prisma.$disconnect();
    })
    .then(() => {
      process.exit(process.exitCode || 0);
    });
}

module.exports = {
  createSyntheticPdfFixture,
  fixtureRecordCounts,
  hasFixtureRecords,
  loadPdfFixture,
};
