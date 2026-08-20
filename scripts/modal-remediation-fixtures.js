const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadEnv } = require("../src/config/env");

loadEnv();

// Fixture setup/cleanup must see and remove its exact cross-scope records.
// Application authorization is still exercised through the API server, which
// keeps using the least-privilege runtime client.
const prisma = require("../src/config/prisma-system");
const {
  assertSafeIntegrationDatabase,
  readAdminCredentials,
} = require("../src/integration/support/integration-test-helpers");
const { hashPassword } = require("../src/utils/bcrypt");

const FIXTURE_KIND = "ruwang-arsip-modal-remediation-regression";
const FIXTURE_VERSION = 1;
const MANIFEST_PATH = path.join(os.tmpdir(), `${FIXTURE_KIND}.json`);
const LONG_TEXT =
  "Catatan regression dengan teks panjang untuk membuktikan isi modal tetap terbaca, tidak memotong kata, dan tidak menimbulkan overflow pada desktop, tablet, maupun telepon genggam.";

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (
    manifest?.kind !== FIXTURE_KIND ||
    manifest?.version !== FIXTURE_VERSION ||
    !manifest?.ids
  ) {
    throw new Error("Manifest fixture remediation modal tidak dikenali.");
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

async function findRequiredBaseline() {
  const credentials = readAdminCredentials();
  const admin = await prisma.users.findUnique({
    where: { username: credentials.username.toLowerCase() },
  });
  if (!admin?.is_active || !admin.division_id) {
    throw new Error("Admin aktif dengan divisi wajib tersedia.");
  }

  const [
    storage,
    documentType,
    letterPriority,
    staffRole,
    collateralTarget,
  ] =
    await Promise.all([
    prisma.storages.findFirst({
      where: { is_active: true },
      orderBy: { created_at: "asc" },
    }),
    prisma.document_types.findFirst({
      where: { is_active: true },
      orderBy: { created_at: "asc" },
    }),
    prisma.letter_priorities.findFirst({ orderBy: { created_at: "asc" } }),
      prisma.roles.findUnique({ where: { name: "Staf" } }),
      prisma.debtor_collaterals.findFirst({
        where: {
          deleted_at: null,
          debtor_id: { not: null },
        },
        select: { debtor_id: true },
        orderBy: { created_at: "desc" },
      }),
    ]);

  if (
    !storage ||
    !documentType ||
    !letterPriority ||
    !staffRole ||
    !collateralTarget?.debtor_id
  ) {
    throw new Error(
      "Storage, jenis dokumen, prioritas surat, role Staf, serta debitur dengan agunan wajib tersedia.",
    );
  }

  return {
    admin,
    collateralDebtorTargetId: collateralTarget.debtor_id,
    documentType,
    letterPriority,
    staffRole,
    storage,
  };
}

async function setup() {
  const database = assertSafeIntegrationDatabase(
    "Modal remediation fixture setup",
  );
  if (readManifest()) {
    throw new Error(
      `Fixture remediation masih aktif. Jalankan cleanup: ${MANIFEST_PATH}`,
    );
  }

  const baseline = await findRequiredBaseline();
  const runId = crypto.randomUUID();
  const suffix = runId.replace(/-/g, "").slice(0, 12);
  const username = `modal_remediation_${suffix}`;
  const password = `Modal-Remediation-${suffix}-123!`;
  const marker = `ModalRemediation/${runId}`;

  const created = await prisma.$transaction(async (tx) => {
    const staff = await tx.users.create({
      data: {
        id: crypto.randomUUID(),
        name: `Staf Regression Modal ${suffix}`,
        username,
        email: `${username}@integration.invalid`,
        password: await hashPassword(password),
        role_id: baseline.staffRole.id,
        division_id: baseline.admin.division_id,
        is_active: true,
        onboarding_status: "ACTIVE",
        email_verified_at: new Date(),
        password_set_at: new Date(),
        activated_at: new Date(),
      },
    });

    const idebDebtor = await tx.digital_debtors.create({
      data: {
        debtor_number: `MODAL-IDEB-${suffix}`,
        identity_number: `9988${suffix}`,
        name: `Debitur Regression iDeb ${suffix}`,
        customer_type: "INDIVIDUAL",
        status: "ACTIVE",
        created_by: baseline.admin.id,
      },
    });
    const idebUpload = await tx.debtor_ideb_uploads.create({
      data: {
        debtor_id: idebDebtor.id,
        source_fingerprint: `modal-remediation-${runId}`,
        month: 8,
        year: 2026,
        status: "COMPLETED",
        result_summary: {
          schema_version: "ideb-v1",
          period_month: "2026-08",
          debtor_number: idebDebtor.debtor_number,
          debtor_name: idebDebtor.name,
          identity_number: idebDebtor.identity_number,
          facilities: [
            {
              reporter_name: "Pelapor Regression Modal",
              account_number: `MODAL-REK-${suffix}`,
              credit_type: "Pembiayaan",
              condition_code: "00",
              collectibility: "1",
              days_past_due: 0,
              plafond: 10_000_000,
              outstanding: 9_000_000,
              period_month: "2026-08",
              history: [
                {
                  period_month: "2026-08",
                  collectibility: "1",
                  days_past_due: 0,
                },
              ],
            },
          ],
        },
        file_path: `/integration/modal-remediation/ideb-${suffix}.txt`,
        file_name: `ideb-${suffix}.txt`,
        mime_type: "text/plain",
        size_bytes: 128,
        uploaded_by: baseline.admin.id,
        created_by: baseline.admin.id,
      },
    });

    const documentBase = {
      storage_id: baseline.storage.id,
      owner_user_id: baseline.admin.id,
      owner_division_id: baseline.admin.division_id,
      document_type_id: baseline.documentType.id,
      description: LONG_TEXT,
      created_by: baseline.admin.id,
    };

    const availableDocument = await tx.digital_documents.create({
      data: {
        ...documentBase,
        document_number: `MODAL-AVAILABLE-${suffix}`,
        document_name: `Dokumen Tersedia Regression ${suffix}`,
        is_restricted: false,
        access_level: "NON_RESTRICT",
      },
    });

    const restrictedDocument = await tx.digital_documents.create({
      data: {
        ...documentBase,
        document_number: `MODAL-RESTRICTED-${suffix}`,
        document_name: `Dokumen Terbatas Regression ${suffix}`,
        is_restricted: true,
        access_level: "RESTRICT",
      },
    });

    const reportDocument = await tx.digital_documents.create({
      data: {
        ...documentBase,
        document_number: `MODAL-LOAN-${suffix}`,
        document_name: `Dokumen Riwayat Peminjaman ${suffix}`,
        is_restricted: false,
        access_level: "NON_RESTRICT",
      },
    });
    const loan = await tx.digital_document_loans.create({
      data: {
        document_id: reportDocument.id,
        borrower_id: staff.id,
        status: "RETURNED",
        request_reason: LONG_TEXT,
        requested_start_date: new Date(Date.now() - 7 * 86_400_000),
        requested_due_date: new Date(Date.now() - 2 * 86_400_000),
        approved_by: baseline.admin.id,
        approved_at: new Date(Date.now() - 7 * 86_400_000),
        approval_note: LONG_TEXT,
        handed_over_by: baseline.admin.id,
        handover_at: new Date(Date.now() - 6 * 86_400_000),
        handover_note: LONG_TEXT,
        returned_by: baseline.admin.id,
        returned_at: new Date(Date.now() - 3 * 86_400_000),
        return_note: LONG_TEXT,
      },
    });

    const incomingMail = await tx.incoming_mails.create({
      data: {
        letter_prioritie_id: baseline.letterPriority.id,
        storage_id: baseline.storage.id,
        name: `Pengirim Regression ${suffix}`,
        receive_date: new Date(),
        address: `Alamat panjang regression ${suffix}`,
        mail_number: `MODAL-EDIT-${suffix}`,
        regarding: `Surat untuk pengujian Edit Surat ${suffix}`,
        description: LONG_TEXT,
        status: "NEW",
        created_by: baseline.admin.id,
        target_divisions: {
          create: {
            division_id: baseline.admin.division_id,
            manager_id: baseline.admin.id,
          },
        },
      },
    });

    const systemLog = await tx.system_activity_logs.create({
      data: {
        actor_id: baseline.admin.id,
        module: "AUTH",
        action: "LOGIN",
        source: "API",
        entity_type: "SESSION",
        entity_id: runId,
        object_label: `Aktivitas regression ${suffix}`,
        title: `Aktivitas regression ${suffix}`,
        summary: LONG_TEXT,
        request_method: "POST",
        request_path: "/api/v1/auth/login",
        response_status: 200,
        request_id: runId,
        user_agent: marker,
      },
    });

    const legalLog = await tx.legal_activity_logs.create({
      data: {
        actor_id: baseline.admin.id,
        action: "CREATE",
        source: "REVIEW_SEED",
        entity_type: "legal_deposit_transactions",
        entity_id: runId,
        title: `Audit regression ${suffix}`,
        metadata: { marker, note: LONG_TEXT },
        user_agent: marker,
      },
    });

    return {
      availableDocument,
      incomingMail,
      idebDebtor,
      idebUpload,
      legalLog,
      loan,
      reportDocument,
      restrictedDocument,
      staff,
      systemLog,
    };
  });

  writeManifest({
    kind: FIXTURE_KIND,
    version: FIXTURE_VERSION,
    runId,
    marker,
    createdAt: new Date().toISOString(),
    database,
    auth: { username, password },
    records: {
      activityTitle: created.systemLog.title,
      availableDocumentNumber: created.availableDocument.document_number,
      incomingMailNumber: created.incomingMail.mail_number,
      legalAuditTitle: created.legalLog.title,
      loanDocumentNumber: created.reportDocument.document_number,
      restrictedDocumentNumber: created.restrictedDocument.document_number,
      collateralDebtorTargetId: baseline.collateralDebtorTargetId,
      idebDebtorTargetId: created.idebDebtor.id,
    },
    ids: {
      availableDocument: created.availableDocument.id,
      incomingMail: created.incomingMail.id,
      idebDebtor: created.idebDebtor.id,
      idebUpload: created.idebUpload.id,
      legalLog: created.legalLog.id,
      loan: created.loan.id,
      reportDocument: created.reportDocument.id,
      restrictedDocument: created.restrictedDocument.id,
      staff: created.staff.id,
      systemLog: created.systemLog.id,
    },
  });

  console.log(
    JSON.stringify({
      status: "created",
      manifest: MANIFEST_PATH,
      records: {
        activity: true,
        available_document: true,
        incoming_mail: true,
        ideb: true,
        legal_audit: true,
        loan_report: true,
        restricted_document: true,
      },
    }),
  );
}

async function cleanup() {
  const database = assertSafeIntegrationDatabase(
    "Modal remediation fixture cleanup",
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
    throw new Error("Database aktif berbeda dari manifest fixture remediation.");
  }

  const ids = manifest.ids;
  const documentIds = [
    ids.availableDocument,
    ids.reportDocument,
    ids.restrictedDocument,
  ];
  const entityIds = [
    ...documentIds,
    ids.idebDebtor,
    ids.idebUpload,
    ids.incomingMail,
    ids.legalLog,
    ids.loan,
    ids.systemLog,
  ];

  const deleted = await prisma.$transaction(async (tx) => {
    const notifications = await tx.notifications.deleteMany({
      where: { entity_id: { in: entityIds } },
    });
    const documentLogs = await tx.digital_document_activity_logs.deleteMany({
      where: { document_id: { in: documentIds } },
    });
    const loans = await tx.digital_document_loans.deleteMany({
      where: { id: ids.loan },
    });
    const documents = await tx.digital_documents.deleteMany({
      where: { id: { in: documentIds } },
    });
    const incomingMail = await tx.incoming_mails.deleteMany({
      where: { id: ids.incomingMail },
    });
    const legalLog = await tx.legal_activity_logs.deleteMany({
      where: { id: ids.legalLog },
    });
    const systemLog = await tx.system_activity_logs.deleteMany({
      where: { id: ids.systemLog },
    });
    const idebFiles = await tx.debtor_ideb_upload_files.deleteMany({
      where: { upload_id: ids.idebUpload },
    });
    const idebUploads = await tx.debtor_ideb_uploads.deleteMany({
      where: { id: ids.idebUpload },
    });
    const idebDebtors = await tx.digital_debtors.deleteMany({
      where: {
        id: ids.idebDebtor,
        debtor_number: { startsWith: "MODAL-IDEB-" },
      },
    });
    const staff = await tx.users.deleteMany({
      where: {
        id: ids.staff,
        username: { startsWith: "modal_remediation_" },
      },
    });
    return {
      document_logs: documentLogs.count,
      documents: documents.count,
      incoming_mail: incomingMail.count,
      ideb_debtors: idebDebtors.count,
      ideb_files: idebFiles.count,
      ideb_uploads: idebUploads.count,
      legal_log: legalLog.count,
      loans: loans.count,
      notifications: notifications.count,
      staff: staff.count,
      system_log: systemLog.count,
    };
  });

  fs.rmSync(MANIFEST_PATH, { force: true });
  console.log(JSON.stringify({ status: "cleaned", deleted }));
}

async function status() {
  const database = assertSafeIntegrationDatabase(
    "Modal remediation fixture status",
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
    throw new Error("Database aktif berbeda dari manifest fixture remediation.");
  }

  const ids = manifest.ids;
  const counts = await Promise.all([
    prisma.users.count({ where: { id: ids.staff } }),
    prisma.digital_documents.count({
      where: {
        id: {
          in: [
            ids.availableDocument,
            ids.reportDocument,
            ids.restrictedDocument,
          ],
        },
      },
    }),
    prisma.digital_document_loans.count({ where: { id: ids.loan } }),
    prisma.incoming_mails.count({ where: { id: ids.incomingMail } }),
    prisma.legal_activity_logs.count({ where: { id: ids.legalLog } }),
    prisma.system_activity_logs.count({ where: { id: ids.systemLog } }),
    prisma.debtor_ideb_uploads.count({ where: { id: ids.idebUpload } }),
    prisma.digital_debtors.count({ where: { id: ids.idebDebtor } }),
  ]);
  console.log(
    JSON.stringify({
      status: "active",
      records: {
        staff: counts[0],
        documents: counts[1],
        loan: counts[2],
        incoming_mail: counts[3],
        legal_log: counts[4],
        system_log: counts[5],
        ideb_upload: counts[6],
        ideb_debtor: counts[7],
      },
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

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
