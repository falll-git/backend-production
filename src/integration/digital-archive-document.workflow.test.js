const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

const { loadEnv } = require("../config/env");

loadEnv();

const { deleteStoredFile } = require("../utils/digital-archive-files");
const {
  createActiveUser,
  createIntegrationFixture,
  futureUtcDate,
  loginAgent,
  readAdminCredentials,
} = require("./support/integration-test-helpers");

const PDF_ONE = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  "utf8",
);
const PDF_TWO = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Version /1.7 >>\nendobj\n%%EOF\n",
  "utf8",
);

function signedPath(fileUrl) {
  const parsed = new URL(fileUrl);
  return `${parsed.pathname}${parsed.search}`;
}

test(
  "dokumen arsip menjalani create, read file, update, disposisi, revoke, reject, dan delete",
  { skip: process.env.RUN_CRITICAL_DB_INTEGRATION !== "true" },
  async (t) => {
    const app = require("../app");
    const prisma = require("../config/prisma-system");
    const fixture = createIntegrationFixture(
      prisma,
      "Digital archive document workflow",
    );
    const adminAgent = request.agent(app);
    const requesterAgent = request.agent(app);
    const adminCredentials = readAdminCredentials();
    const storedPaths = new Set();
    let adminAccessToken = null;
    let requesterAccessToken = null;

    t.after(async () => {
      if (adminAccessToken) {
        await adminAgent
          .post("/api/v1/auth/logout")
          .set("User-Agent", fixture.userAgent)
          .set("Authorization", `Bearer ${adminAccessToken}`);
      }
      if (requesterAccessToken) {
        await requesterAgent
          .post("/api/v1/auth/logout")
          .set("User-Agent", fixture.userAgent)
          .set("Authorization", `Bearer ${requesterAccessToken}`);
      }
      await fixture.cleanup();
      for (const storedPath of storedPaths) deleteStoredFile(storedPath);
      await prisma.$disconnect();
    });

    const admin = await prisma.users.findUnique({
      where: { username: adminCredentials.username.toLowerCase() },
    });
    assert.ok(admin, "Admin integration test wajib tersedia.");
    const [storage, documentType] = await Promise.all([
      prisma.storages.findFirst({ where: { is_active: true } }),
      prisma.document_types.findFirst({ where: { is_active: true } }),
    ]);
    assert.ok(storage, "Lokasi penyimpanan aktif wajib tersedia.");
    assert.ok(documentType, "Jenis dokumen aktif wajib tersedia.");

    const requester = await createActiveUser(prisma, fixture, {
      roleId: admin.role_id,
      divisionId: admin.division_id,
      name: fixture.name("Pemohon Akses Arsip"),
    });
    const adminLogin = await loginAgent(
      adminAgent,
      adminCredentials,
      fixture.userAgent,
    );
    adminAccessToken = adminLogin.accessToken;
    const requesterLogin = await loginAgent(
      requesterAgent,
      { username: requester.username, password: requester.password },
      fixture.userAgent,
    );
    requesterAccessToken = requesterLogin.accessToken;

    const created = await adminAgent
      .post("/api/v1/digital-documents")
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .field("storage_id", storage.id)
      .field("document_type_id", documentType.id)
      .field("owner_user_id", admin.id)
      .field("owner_division_id", admin.division_id)
      .field("document_name", fixture.name("Dokumen Arsip Nyata"))
      .field("description", "Dokumen fixture untuk workflow arsip lengkap")
      .field("is_restricted", "true")
      .attach("file", PDF_ONE, {
        filename: "arsip-workflow-awal.pdf",
        contentType: "application/pdf",
      })
      .expect(201);

    const documentId = created.body.data?.id;
    assert.equal(typeof documentId, "string");
    fixture.track("digitalDocument", documentId);
    assert.equal(created.body.data.is_restricted, true);
    assert.equal(created.body.data.file?.mime_type, "application/pdf");
    assert.equal(typeof created.body.data.file?.url, "string");

    let storedDocument = await prisma.digital_documents.findUnique({
      where: { id: documentId },
      include: { document_files: true },
    });
    assert.equal(storedDocument.document_files.length, 1);
    assert.equal(storedDocument.document_files[0].file_name, "arsip-workflow-awal.pdf");
    assert.equal(storedDocument.document_files[0].size_bytes, BigInt(PDF_ONE.length));
    storedPaths.add(storedDocument.file);

    await request(app)
      .get(new URL(created.body.data.file.url).pathname)
      .expect(401);
    const downloadedInitial = await request(app)
      .get(signedPath(created.body.data.file.url))
      .expect("Cache-Control", /private, no-store/)
      .expect("Content-Type", /application\/pdf/)
      .expect(200);
    assert.ok(Buffer.isBuffer(downloadedInitial.body));
    assert.deepEqual(downloadedInitial.body, PDF_ONE);

    await requesterAgent
      .get(`/api/v1/digital-documents/${documentId}`)
      .set("User-Agent", fixture.userAgent)
      .set(requesterLogin.authorization)
      .expect(404);
    await requesterAgent
      .put(`/api/v1/digital-documents/${documentId}`)
      .set("User-Agent", fixture.userAgent)
      .set(requesterLogin.authorization)
      .field("document_name", "Percobaan update di luar scope")
      .expect(404);

    const updated = await adminAgent
      .put(`/api/v1/digital-documents/${documentId}`)
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .field("document_name", fixture.name("Dokumen Arsip Diperbarui"))
      .field("description", "Metadata dan file sudah diperbarui")
      .attach("file", PDF_TWO, {
        filename: "arsip-workflow-baru.pdf",
        contentType: "application/pdf",
      })
      .expect(200);
    assert.equal(updated.body.data.description, "Metadata dan file sudah diperbarui");
    assert.equal(updated.body.data.file.name, "arsip-workflow-baru.pdf");

    storedDocument = await prisma.digital_documents.findUnique({
      where: { id: documentId },
      include: { document_files: true },
    });
    storedPaths.add(storedDocument.file);
    assert.equal(storedDocument.document_files.length, 2);
    assert.equal(
      storedDocument.document_files.filter((item) => item.is_primary).length,
      1,
    );
    const downloadedUpdated = await request(app)
      .get(signedPath(updated.body.data.file.url))
      .expect("Content-Type", /application\/pdf/)
      .expect(200);
    assert.deepEqual(downloadedUpdated.body, PDF_TWO);

    const requested = await requesterAgent
      .post("/api/v1/digital-document-access-requests")
      .set("User-Agent", fixture.userAgent)
      .set(requesterLogin.authorization)
      .send({
        document_ids: [documentId],
        request_reason: "Membutuhkan dokumen untuk pengujian disposisi",
        expires_at: futureUtcDate({ days: 7 }).toISOString(),
      })
      .expect((response) => {
        assert.equal(
          response.statusCode,
          201,
          `Pengajuan akses gagal: ${JSON.stringify(response.body)}`,
        );
      });
    const accessRequestId = requested.body.data?.items?.[0]?.id;
    assert.equal(typeof accessRequestId, "string");
    fixture.track("notificationEntity", accessRequestId);

    await requesterAgent
      .patch(`/api/v1/digital-document-access-requests/${accessRequestId}/approve`)
      .set("User-Agent", fixture.userAgent)
      .set(requesterLogin.authorization)
      .send({ action_note: "Tidak boleh menyetujui permintaan sendiri" })
      .expect(403);

    await adminAgent
      .patch(`/api/v1/digital-document-access-requests/${accessRequestId}/approve`)
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .send({ action_note: "Akses disetujui untuk pengujian" })
      .expect(200);
    let storedAccess = await prisma.digital_document_access_requests.findUnique({
      where: { id: accessRequestId },
    });
    assert.equal(storedAccess.status, "APPROVED");
    assert.equal(storedAccess.acted_by, admin.id);

    const requesterDocument = await requesterAgent
      .get(`/api/v1/digital-documents/${documentId}`)
      .set("User-Agent", fixture.userAgent)
      .set(requesterLogin.authorization)
      .expect(200);
    await request(app)
      .get(signedPath(requesterDocument.body.data.file.url))
      .expect("Content-Type", /application\/pdf/)
      .expect(200);

    await adminAgent
      .patch(`/api/v1/digital-document-access-requests/${accessRequestId}/revoke`)
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .send({ action_note: "Akses dicabut setelah verifikasi" })
      .expect(200);
    storedAccess = await prisma.digital_document_access_requests.findUnique({
      where: { id: accessRequestId },
    });
    assert.equal(storedAccess.status, "REVOKED");
    await requesterAgent
      .get(`/api/v1/digital-documents/${documentId}`)
      .set("User-Agent", fixture.userAgent)
      .set(requesterLogin.authorization)
      .expect(404);
    await request(app)
      .get(signedPath(requesterDocument.body.data.file.url))
      .expect(403);

    const secondRequest = await requesterAgent
      .post("/api/v1/digital-document-access-requests")
      .set("User-Agent", fixture.userAgent)
      .set(requesterLogin.authorization)
      .send({
        document_ids: [documentId],
        request_reason: "Pengajuan kedua untuk menguji penolakan",
        expires_at: futureUtcDate({ days: 7 }).toISOString(),
      })
      .expect(201);
    const rejectedRequestId = secondRequest.body.data?.items?.[0]?.id;
    fixture.track("notificationEntity", rejectedRequestId);
    await adminAgent
      .patch(`/api/v1/digital-document-access-requests/${rejectedRequestId}/reject`)
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .send({ action_note: "Ditolak untuk memverifikasi status akhir" })
      .expect(200);
    assert.equal(
      (
        await prisma.digital_document_access_requests.findUnique({
          where: { id: rejectedRequestId },
        })
      ).status,
      "REJECTED",
    );

    for (const reportPath of [
      "/api/v1/digital-archives/reports/summary",
      "/api/v1/digital-archives/reports/documents",
      "/api/v1/digital-archives/reports/due-dates",
      "/api/v1/digital-archives/reports/access-requests",
      "/api/v1/digital-archives/reports/loans",
    ]) {
      await adminAgent
        .get(reportPath)
        .set("User-Agent", fixture.userAgent)
        .set(adminLogin.authorization)
        .expect(200);
    }

    await adminAgent
      .delete(`/api/v1/digital-documents/${documentId}`)
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .expect(200);
    storedDocument = await prisma.digital_documents.findUnique({
      where: { id: documentId },
    });
    assert.ok(storedDocument.deleted_at);
    assert.equal(storedDocument.deleted_by, admin.id);
    await request(app)
      .get(signedPath(updated.body.data.file.url))
      .expect(403);

    const actions = await prisma.digital_document_activity_logs.findMany({
      where: { document_id: documentId },
      orderBy: { created_at: "asc" },
      select: { action: true },
    });
    assert.deepEqual(
      actions.map((item) => item.action),
      [
        "CREATED",
        "UPDATED",
        "ACCESS_REQUESTED",
        "ACCESS_APPROVED",
        "ACCESS_REVOKED",
        "ACCESS_REQUESTED",
        "ACCESS_REJECTED",
        "DELETED",
      ],
    );
  },
);
