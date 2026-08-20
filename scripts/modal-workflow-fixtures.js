const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadEnv } = require("../src/config/env");

loadEnv();

// This client is reserved for guarded local fixture lifecycle operations.
// Runtime requests continue to use the RLS-constrained application client.
const prisma = require("../src/config/prisma-system");
const {
  assertSafeIntegrationDatabase,
  readAdminCredentials,
} = require("../src/integration/support/integration-test-helpers");
const { hashPassword } = require("../src/utils/bcrypt");

const FIXTURE_KIND = "ruwang-arsip-modal-workflow-regression";
const FIXTURE_VERSION = 1;
const MANIFEST_PATH = path.join(os.tmpdir(), `${FIXTURE_KIND}.json`);
const LONG_TEXT =
  "Instruksi regression dengan teks panjang untuk memastikan susunan informasi tetap mudah dipindai, tidak memotong kata secara agresif, dan tidak menimbulkan overflow pada layar tablet maupun telepon genggam.";

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (
    manifest?.kind !== FIXTURE_KIND ||
    manifest?.version !== FIXTURE_VERSION ||
    !manifest?.ids
  ) {
    throw new Error("Manifest fixture modal tidak dikenali; cleanup dihentikan.");
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

function utcDate({ days = 0, hours = 0 } = {}) {
  const value = new Date();
  value.setUTCHours(12 + hours, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

async function findRequiredBaseline() {
  const credentials = readAdminCredentials();
  const admin = await prisma.users.findUnique({
    where: { username: credentials.username.toLowerCase() },
  });
  if (!admin?.is_active || !admin.division_id) {
    throw new Error("Admin aktif dengan divisi wajib tersedia untuk fixture modal.");
  }

  const [storage, documentType, letterPriority, staffRole] = await Promise.all([
    prisma.storages.findFirst({ where: { is_active: true }, orderBy: { created_at: "asc" } }),
    prisma.document_types.findFirst({
      where: { is_active: true },
      orderBy: { created_at: "asc" },
    }),
    prisma.letter_priorities.findFirst({ orderBy: { created_at: "asc" } }),
    prisma.roles.findUnique({ where: { name: "Staf" } }),
  ]);

  if (!storage || !documentType || !letterPriority || !staffRole) {
    throw new Error(
      "Storage, jenis dokumen, prioritas surat, dan role Staf wajib tersedia.",
    );
  }

  return { admin, documentType, letterPriority, staffRole, storage };
}

async function setup() {
  const database = assertSafeIntegrationDatabase("Modal workflow fixture setup");
  if (readManifest()) {
    throw new Error(
      `Fixture modal masih aktif. Jalankan cleanup terlebih dahulu: ${MANIFEST_PATH}`,
    );
  }

  const baseline = await findRequiredBaseline();
  const runId = crypto.randomUUID();
  const suffix = runId.replace(/-/g, "").slice(0, 12);
  const username = `modal_regression_${suffix}`;
  const marker = `ModalRegression/${runId}`;

  const created = await prisma.$transaction(async (tx) => {
    const borrower = await tx.users.create({
      data: {
        id: crypto.randomUUID(),
        name: `Petugas Regression Dengan Nama Sangat Panjang ${suffix}`,
        username,
        email: `${username}@integration.invalid`,
        password: await hashPassword(`Modal-Regression-${suffix}-123!`),
        role_id: baseline.staffRole.id,
        division_id: baseline.admin.division_id,
        is_active: true,
        onboarding_status: "ACTIVE",
        email_verified_at: new Date(),
        password_set_at: new Date(),
        activated_at: new Date(),
      },
    });

    const incomingMail = await tx.incoming_mails.create({
      data: {
        letter_prioritie_id: baseline.letterPriority.id,
        storage_id: baseline.storage.id,
        name: `Pengirim Regression ${suffix}`,
        receive_date: utcDate({ days: -3 }),
        address: `Alamat pengirim dengan keterangan panjang ${suffix}`,
        mail_number: `MODAL-SM-${suffix}`,
        regarding: `Surat masuk untuk audit disposisi dan tenggat ${suffix}`,
        description: LONG_TEXT,
        status: "IN_PROGRESS",
        created_by: baseline.admin.id,
        target_divisions: {
          create: {
            division_id: baseline.admin.division_id,
            manager_id: baseline.admin.id,
          },
        },
        disposition_mails: {
          create: {
            sender_id: baseline.admin.id,
            receiver_id: baseline.admin.id,
            note: LONG_TEXT,
            start_date: utcDate({ days: -3 }),
            due_date: utcDate({ days: -1 }),
            status: "IN_PROGRESS",
            acted_at: utcDate({ days: -3 }),
          },
        },
      },
      include: { disposition_mails: true },
    });

    const memorandum = await tx.memorandums.create({
      data: {
        origin_division_id: baseline.admin.division_id,
        storage_id: baseline.storage.id,
        memo_number: `MODAL-MEMO-${suffix}`,
        memo_date: utcDate({ days: -2 }),
        received_date: utcDate({ days: -2 }),
        regarding: `Memorandum audit redisposisi ${suffix}`,
        description: LONG_TEXT,
        status: "IN_PROGRESS",
        created_by: baseline.admin.id,
        target_divisions: {
          create: {
            division_id: baseline.admin.division_id,
            manager_id: baseline.admin.id,
          },
        },
        dispositions: {
          create: {
            sender_id: baseline.admin.id,
            receiver_id: baseline.admin.id,
            note: LONG_TEXT,
            start_date: utcDate({ days: -2 }),
            due_date: utcDate({ days: 7 }),
            status: "IN_PROGRESS",
            acted_at: utcDate({ days: -2 }),
          },
        },
      },
      include: { dispositions: true },
    });

    const documentBase = {
      storage_id: baseline.storage.id,
      owner_user_id: baseline.admin.id,
      owner_division_id: baseline.admin.division_id,
      is_restricted: false,
      access_level: "NON_RESTRICT",
      document_type_id: baseline.documentType.id,
      description: LONG_TEXT,
      created_by: baseline.admin.id,
    };

    const handoverDocument = await tx.digital_documents.create({
      data: {
        ...documentBase,
        document_number: `MODAL-HANDOVER-${suffix}`,
        document_name: `Dokumen Siap Serah ${suffix}`,
      },
    });
    const returnDocument = await tx.digital_documents.create({
      data: {
        ...documentBase,
        document_number: `MODAL-RETURN-${suffix}`,
        document_name: `Dokumen Siap Dikembalikan ${suffix}`,
      },
    });

    const handoverLoan = await tx.digital_document_loans.create({
      data: {
        document_id: handoverDocument.id,
        borrower_id: borrower.id,
        status: "APPROVED",
        request_reason: LONG_TEXT,
        requested_start_date: utcDate({ days: -1 }),
        requested_due_date: utcDate({ days: 14 }),
        approved_by: baseline.admin.id,
        approved_at: utcDate({ days: -1 }),
        approval_note: "Disetujui untuk audit modal serah terima.",
      },
    });
    const returnLoan = await tx.digital_document_loans.create({
      data: {
        document_id: returnDocument.id,
        borrower_id: borrower.id,
        status: "HANDED_OVER",
        request_reason: LONG_TEXT,
        requested_start_date: utcDate({ days: -4 }),
        requested_due_date: utcDate({ days: 10 }),
        approved_by: baseline.admin.id,
        approved_at: utcDate({ days: -4 }),
        approval_note: "Disetujui untuk audit modal pengembalian.",
        handed_over_by: baseline.admin.id,
        handover_at: utcDate({ days: -3 }),
        handover_note: LONG_TEXT,
      },
    });

    const pendingAccessRequest = await tx.digital_document_access_requests.create({
      data: {
        document_id: handoverDocument.id,
        requester_id: borrower.id,
        owner_id: baseline.admin.id,
        status: "PENDING",
        request_reason: LONG_TEXT,
        expires_at: utcDate({ days: 30 }),
      },
    });
    const approvedAccessRequest = await tx.digital_document_access_requests.create({
      data: {
        document_id: returnDocument.id,
        requester_id: borrower.id,
        owner_id: baseline.admin.id,
        status: "APPROVED",
        request_reason: LONG_TEXT,
        action_note: "Akses disetujui untuk audit modal historis disposisi.",
        expires_at: utcDate({ days: 30 }),
        acted_by: baseline.admin.id,
        acted_at: utcDate({ days: -1 }),
        approved_at: utcDate({ days: -1 }),
      },
    });

    await tx.digital_document_activity_logs.createMany({
      data: [
        {
          document_id: handoverDocument.id,
          actor_id: baseline.admin.id,
          action: "LOAN_REQUESTED",
          reference_type: "DIGITAL_DOCUMENT_LOAN",
          reference_id: handoverLoan.id,
          description: marker,
        },
        {
          document_id: handoverDocument.id,
          actor_id: baseline.admin.id,
          action: "LOAN_APPROVED",
          reference_type: "DIGITAL_DOCUMENT_LOAN",
          reference_id: handoverLoan.id,
          description: marker,
        },
        {
          document_id: returnDocument.id,
          actor_id: baseline.admin.id,
          action: "LOAN_REQUESTED",
          reference_type: "DIGITAL_DOCUMENT_LOAN",
          reference_id: returnLoan.id,
          description: marker,
        },
        {
          document_id: returnDocument.id,
          actor_id: baseline.admin.id,
          action: "LOAN_APPROVED",
          reference_type: "DIGITAL_DOCUMENT_LOAN",
          reference_id: returnLoan.id,
          description: marker,
        },
        {
          document_id: returnDocument.id,
          actor_id: baseline.admin.id,
          action: "LOAN_HANDED_OVER",
          reference_type: "DIGITAL_DOCUMENT_LOAN",
          reference_id: returnLoan.id,
          description: marker,
        },
        {
          document_id: returnDocument.id,
          actor_id: baseline.admin.id,
          action: "CREATED",
          to_storage_id: baseline.storage.id,
          reference_type: "DIGITAL_DOCUMENT",
          reference_id: returnDocument.id,
          description: marker,
        },
      ],
    });

    return {
      borrower,
      handoverDocument,
      handoverLoan,
      pendingAccessRequest,
      incomingMail,
      memorandum,
      approvedAccessRequest,
      returnDocument,
      returnLoan,
    };
  });

  const manifest = {
    kind: FIXTURE_KIND,
    version: FIXTURE_VERSION,
    runId,
    marker,
    createdAt: new Date().toISOString(),
    database,
    records: {
      incomingMailNumber: created.incomingMail.mail_number,
      memorandumNumber: created.memorandum.memo_number,
      handoverDocumentNumber: created.handoverDocument.document_number,
      returnDocumentNumber: created.returnDocument.document_number,
    },
    ids: {
      borrower: created.borrower.id,
      incomingMail: created.incomingMail.id,
      incomingDisposition: created.incomingMail.disposition_mails[0].id,
      memorandum: created.memorandum.id,
      memorandumDisposition: created.memorandum.dispositions[0].id,
      handoverDocument: created.handoverDocument.id,
      handoverLoan: created.handoverLoan.id,
      pendingAccessRequest: created.pendingAccessRequest.id,
      returnDocument: created.returnDocument.id,
      returnLoan: created.returnLoan.id,
      approvedAccessRequest: created.approvedAccessRequest.id,
    },
  };
  writeManifest(manifest);

  console.log(
    JSON.stringify(
      {
        status: "created",
        manifest: MANIFEST_PATH,
        fixture: {
          incoming_mail_number: created.incomingMail.mail_number,
          memorandum_number: created.memorandum.memo_number,
          handover_document_number: created.handoverDocument.document_number,
          return_document_number: created.returnDocument.document_number,
        },
      },
      null,
      2,
    ),
  );
}

async function cleanup() {
  const database = assertSafeIntegrationDatabase("Modal workflow fixture cleanup");
  const manifest = readManifest();
  if (!manifest) {
    console.log(JSON.stringify({ status: "clean", manifest: MANIFEST_PATH }, null, 2));
    return;
  }
  if (
    manifest.database.databaseName !== database.databaseName ||
    manifest.database.hostname !== database.hostname
  ) {
    throw new Error("Database aktif tidak sama dengan database pada manifest fixture.");
  }

  const ids = manifest.ids;
  const [incomingDispositions, memorandumDispositions] = await Promise.all([
    prisma.incoming_mail_dispositions.findMany({
      where: { incoming_mails_id: ids.incomingMail },
      select: { id: true },
    }),
    prisma.memorandum_dispositions.findMany({
      where: { memorandums_id: ids.memorandum },
      select: { id: true },
    }),
  ]);
  const entityIds = [
    ids.incomingMail,
    ids.memorandum,
    ids.handoverLoan,
    ids.returnLoan,
    ids.pendingAccessRequest,
    ids.approvedAccessRequest,
    ids.handoverDocument,
    ids.returnDocument,
    ...incomingDispositions.map((item) => item.id),
    ...memorandumDispositions.map((item) => item.id),
  ];

  const deleted = await prisma.$transaction(async (tx) => {
    const notifications = await tx.notifications.deleteMany({
      where: { entity_id: { in: entityIds } },
    });
    const activities = await tx.system_activity_logs.deleteMany({
      where: { entity_id: { in: entityIds } },
    });
    const loans = await tx.digital_document_loans.deleteMany({
      where: { id: { in: [ids.handoverLoan, ids.returnLoan] } },
    });
    const documents = await tx.digital_documents.deleteMany({
      where: { id: { in: [ids.handoverDocument, ids.returnDocument] } },
    });
    const incomingMail = await tx.incoming_mails.deleteMany({
      where: { id: ids.incomingMail },
    });
    const memorandum = await tx.memorandums.deleteMany({
      where: { id: ids.memorandum },
    });
    const borrower = await tx.users.deleteMany({
      where: { id: ids.borrower, username: { startsWith: "modal_regression_" } },
    });
    return {
      activities: activities.count,
      borrower: borrower.count,
      documents: documents.count,
      incoming_mail: incomingMail.count,
      loans: loans.count,
      memorandum: memorandum.count,
      notifications: notifications.count,
    };
  });

  fs.rmSync(MANIFEST_PATH, { force: true });
  console.log(JSON.stringify({ status: "cleaned", deleted }, null, 2));
}

async function status() {
  const database = assertSafeIntegrationDatabase("Modal workflow fixture status");
  const manifest = readManifest();
  if (!manifest) {
    console.log(JSON.stringify({ status: "absent", manifest: MANIFEST_PATH }, null, 2));
    return;
  }
  if (
    manifest.database.databaseName !== database.databaseName ||
    manifest.database.hostname !== database.hostname
  ) {
    throw new Error("Database aktif tidak sama dengan database pada manifest fixture.");
  }
  const ids = manifest.ids;
  const [incomingMail, memorandum, accessRequests, loans, documents, borrower] = await Promise.all([
    prisma.incoming_mails.count({ where: { id: ids.incomingMail } }),
    prisma.memorandums.count({ where: { id: ids.memorandum } }),
    prisma.digital_document_access_requests.count({
      where: { id: { in: [ids.pendingAccessRequest, ids.approvedAccessRequest] } },
    }),
    prisma.digital_document_loans.count({
      where: { id: { in: [ids.handoverLoan, ids.returnLoan] } },
    }),
    prisma.digital_documents.count({
      where: { id: { in: [ids.handoverDocument, ids.returnDocument] } },
    }),
    prisma.users.count({ where: { id: ids.borrower } }),
  ]);
  console.log(
    JSON.stringify(
      {
        status: "active",
        records: {
          access_requests: accessRequests,
          borrower,
          documents,
          incoming_mail: incomingMail,
          loans,
          memorandum,
        },
      },
      null,
      2,
    ),
  );
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
