const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

const { loadEnv } = require("../config/env");

loadEnv();

const {
  createActiveUser,
  createIntegrationFixture,
  futureUtcDate,
  loginAgent,
  readAdminCredentials,
} = require("./support/integration-test-helpers");

test(
  "peminjaman arsip melewati request, approval, handover, dan return di PostgreSQL",
  { skip: process.env.RUN_CRITICAL_DB_INTEGRATION !== "true" },
  async (t) => {
    const app = require("../app");
    const prisma = require("../config/prisma-system");
    const fixture = createIntegrationFixture(prisma, "Digital archive loan workflow");
    const adminAgent = request.agent(app);
    const borrowerAgent = request.agent(app);
    const adminCredentials = readAdminCredentials();
    let adminAccessToken = null;
    let borrowerAccessToken = null;

    t.after(async () => {
      if (adminAccessToken) {
        await adminAgent
          .post("/api/v1/auth/logout")
          .set("User-Agent", fixture.userAgent)
          .set("Authorization", `Bearer ${adminAccessToken}`);
      }
      if (borrowerAccessToken) {
        await borrowerAgent
          .post("/api/v1/auth/logout")
          .set("User-Agent", fixture.userAgent)
          .set("Authorization", `Bearer ${borrowerAccessToken}`);
      }
      await fixture.cleanup();
      await prisma.$disconnect();
    });

    const admin = await prisma.users.findUnique({
      where: { username: adminCredentials.username.toLowerCase() },
    });
    assert.ok(admin, "Admin integration test harus tersedia pada database.");
    assert.ok(admin.division_id, "Admin integration test harus memiliki divisi.");

    const [storage, documentType, borrowerRole] = await Promise.all([
      prisma.storages.findFirst({ where: { is_active: true } }),
      prisma.document_types.findFirst({ where: { is_active: true } }),
      prisma.roles.findUnique({ where: { name: "Staf" } }),
    ]);
    assert.ok(storage, "Minimal satu lokasi penyimpanan aktif wajib tersedia.");
    assert.ok(documentType, "Minimal satu jenis dokumen aktif wajib tersedia.");
    assert.ok(borrowerRole, "Role Staf wajib tersedia untuk menguji scope peminjam.");

    const borrower = await createActiveUser(prisma, fixture, {
      roleId: borrowerRole.id,
      divisionId: admin.division_id,
      name: fixture.name("Peminjam Arsip"),
    });
    const document = await prisma.digital_documents.create({
      data: {
        storage_id: storage.id,
        owner_user_id: admin.id,
        owner_division_id: admin.division_id,
        is_restricted: false,
        access_level: "NON_RESTRICT",
        document_type_id: documentType.id,
        document_number: `IT-DOC-${fixture.runId.slice(0, 8)}`,
        document_name: fixture.name("Dokumen Peminjaman"),
        description: "Fixture workflow peminjaman arsip",
        created_by: admin.id,
        related_users: {
          create: { user_id: borrower.user.id },
        },
      },
    });
    fixture.track("digitalDocument", document.id);

    const borrowerLogin = await loginAgent(
      borrowerAgent,
      { username: borrower.username, password: borrower.password },
      fixture.userAgent,
    );
    borrowerAccessToken = borrowerLogin.accessToken;
    const requestedStartDate = futureUtcDate({ days: 1 }).toISOString();
    const requestedDueDate = futureUtcDate({ days: 8 }).toISOString();

    const availableDocuments = await borrowerAgent
      .get("/api/v1/digital-documents")
      .query({ search: document.document_number })
      .set("User-Agent", fixture.userAgent)
      .set(borrowerLogin.authorization)
      .expect(200);
    const availableDocument = availableDocuments.body.data?.find(
      (item) => item.id === document.id,
    );
    assert.equal(availableDocument?.availability_status_key, "AVAILABLE");
    assert.equal(availableDocument?.availability_status_label, "Tersedia");

    const requested = await borrowerAgent
      .post("/api/v1/digital-document-loans")
      .set("User-Agent", fixture.userAgent)
      .set(borrowerLogin.authorization)
      .send({
        document_ids: [document.id],
        requested_start_date: requestedStartDate,
        requested_due_date: requestedDueDate,
        request_reason: "Pengujian workflow arsip sampai pengembalian",
      })
      .expect(201);
    const loanId = requested.body.data?.items?.[0]?.id;
    assert.equal(typeof loanId, "string");
    fixture.track("notificationEntity", loanId);

    const storedPending = await prisma.digital_document_loans.findUnique({
      where: { id: loanId },
    });
    assert.equal(storedPending.status, "PENDING");
    assert.equal(storedPending.borrower_id, borrower.user.id);

    const requestedDocuments = await borrowerAgent
      .get("/api/v1/digital-documents")
      .query({ search: document.document_number })
      .set("User-Agent", fixture.userAgent)
      .set(borrowerLogin.authorization)
      .expect(200);
    const requestedDocument = requestedDocuments.body.data?.find(
      (item) => item.id === document.id,
    );
    assert.equal(requestedDocument?.availability_status_key, "REQUESTED");
    assert.equal(requestedDocument?.availability_status_label, "Diajukan");
    assert.equal(requestedDocument?.current_loan?.status_key, "PENDING");

    await borrowerAgent
      .patch(`/api/v1/digital-document-loans/${loanId}/approve`)
      .set("User-Agent", fixture.userAgent)
      .set(borrowerLogin.authorization)
      .send({ approval_note: "Tidak boleh menyetujui sendiri" })
      .expect(403);
    const stillPending = await prisma.digital_document_loans.findUnique({
      where: { id: loanId },
    });
    assert.equal(stillPending.status, "PENDING");

    const adminLogin = await loginAgent(
      adminAgent,
      adminCredentials,
      fixture.userAgent,
    );
    adminAccessToken = adminLogin.accessToken;

    await adminAgent
      .patch(`/api/v1/digital-document-loans/${loanId}/approve`)
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .send({ approval_note: "Disetujui oleh petugas arsip" })
      .expect(200);
    let stored = await prisma.digital_document_loans.findUnique({
      where: { id: loanId },
    });
    assert.equal(stored.status, "APPROVED");
    assert.equal(stored.approved_by, admin.id);

    const processingDocuments = await borrowerAgent
      .get("/api/v1/digital-documents")
      .query({ search: document.document_number })
      .set("User-Agent", fixture.userAgent)
      .set(borrowerLogin.authorization)
      .expect(200);
    const processingDocument = processingDocuments.body.data?.find(
      (item) => item.id === document.id,
    );
    assert.equal(processingDocument?.availability_status_key, "PROCESSING");
    assert.equal(processingDocument?.availability_status_label, "Dalam Proses");

    const handoverAt = futureUtcDate({ days: 1 }).toISOString();
    await adminAgent
      .patch(`/api/v1/digital-document-loans/${loanId}/handover`)
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .send({
        handover_at: handoverAt,
        handover_note: "Dokumen diserahkan dalam kondisi baik",
      })
      .expect(200);
    stored = await prisma.digital_document_loans.findUnique({
      where: { id: loanId },
    });
    assert.equal(stored.status, "HANDED_OVER");
    assert.equal(stored.handed_over_by, admin.id);

    const borrowedDocuments = await borrowerAgent
      .get("/api/v1/digital-documents")
      .query({ search: document.document_number })
      .set("User-Agent", fixture.userAgent)
      .set(borrowerLogin.authorization)
      .expect(200);
    const borrowedDocument = borrowedDocuments.body.data?.find(
      (item) => item.id === document.id,
    );
    assert.equal(borrowedDocument?.availability_status_key, "BORROWED");
    assert.equal(borrowedDocument?.availability_status_label, "Dipinjam");

    const returnedAt = futureUtcDate({ days: 2 }).toISOString();
    await adminAgent
      .patch(`/api/v1/digital-document-loans/${loanId}/return`)
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .send({
        returned_at: returnedAt,
        return_note: "Dokumen diterima kembali dalam kondisi baik",
      })
      .expect(200);
    stored = await prisma.digital_document_loans.findUnique({
      where: { id: loanId },
    });
    assert.equal(stored.status, "RETURNED");
    assert.equal(stored.returned_by, admin.id);

    const returnedDocuments = await borrowerAgent
      .get("/api/v1/digital-documents")
      .query({ search: document.document_number })
      .set("User-Agent", fixture.userAgent)
      .set(borrowerLogin.authorization)
      .expect(200);
    const returnedDocument = returnedDocuments.body.data?.find(
      (item) => item.id === document.id,
    );
    assert.equal(returnedDocument?.availability_status_key, "AVAILABLE");
    assert.equal(returnedDocument?.availability_status_label, "Tersedia");
    assert.equal(returnedDocument?.current_loan, null);

    const activities = await prisma.digital_document_activity_logs.findMany({
      where: { document_id: document.id, reference_id: loanId },
      orderBy: { created_at: "asc" },
      select: { action: true },
    });
    assert.deepEqual(
      activities.map((item) => item.action),
      [
        "LOAN_REQUESTED",
        "LOAN_APPROVED",
        "LOAN_HANDED_OVER",
        "LOAN_RETURNED",
      ],
    );

    const returnedResponse = await borrowerAgent
      .get(`/api/v1/digital-document-loans/${loanId}`)
      .set("User-Agent", fixture.userAgent)
      .set(borrowerLogin.authorization)
      .expect(200);
    assert.equal(returnedResponse.body.data.status_key, "RETURNED");
  },
);
