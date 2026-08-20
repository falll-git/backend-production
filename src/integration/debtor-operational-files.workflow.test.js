const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

const { loadEnv } = require("../config/env");

loadEnv();

const { deleteStoredFile } = require("../utils/digital-archive-files");
const {
  createActiveUser,
  createIntegrationFixture,
  loginAgent,
  readAdminCredentials,
} = require("./support/integration-test-helpers");

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  "utf8",
);

function signedPath(fileUrl) {
  const parsed = new URL(fileUrl);
  return `${parsed.pathname}${parsed.search}`;
}

async function verifyPrivatePdf(app, file, { verifyUnsigned = false } = {}) {
  assert.ok(file?.url, "URL file bertanda tangan wajib tersedia.");
  if (verifyUnsigned) {
    await request(app).get(new URL(file.url).pathname).expect(401);
  }
  const response = await request(app)
    .get(signedPath(file.url))
    .expect("Cache-Control", /private, no-store/)
    .expect("Content-Type", /application\/pdf/)
    .expect(200);
  assert.ok(Buffer.isBuffer(response.body));
  assert.equal(response.body.subarray(0, 4).toString("utf8"), "%PDF");
}

test(
  "dokumen debitur, aktivitas marketing, dan surat peringatan menyimpan file nyata",
  { skip: process.env.RUN_CRITICAL_DB_INTEGRATION !== "true" },
  async (t) => {
    const app = require("../app");
    const prisma = require("../config/prisma-system");
    const fixture = createIntegrationFixture(
      prisma,
      "Debtor operational files workflow",
    );
    const agent = request.agent(app);
    const outsiderAgent = request.agent(app);
    const credentials = readAdminCredentials();
    const storedPaths = new Set();
    let accessToken = null;
    let outsiderAccessToken = null;

    t.after(async () => {
      if (accessToken) {
        await agent
          .post("/api/v1/auth/logout")
          .set("User-Agent", fixture.userAgent)
          .set("Authorization", `Bearer ${accessToken}`)
          .catch(() => {});
      }
      if (outsiderAccessToken) {
        await outsiderAgent
          .post("/api/v1/auth/logout")
          .set("User-Agent", fixture.userAgent)
          .set("Authorization", `Bearer ${outsiderAccessToken}`)
          .catch(() => {});
      }
      await fixture.cleanup();
      for (const storedPath of storedPaths) deleteStoredFile(storedPath);
      await prisma.$disconnect();
    });

    const admin = await prisma.users.findUnique({
      where: { username: credentials.username.toLowerCase() },
    });
    assert.ok(admin, "Admin integration test wajib tersedia.");
    const [product, contractType, checklist, staffRole, division] = await Promise.all([
      prisma.financing_products.findFirst({ where: { is_active: true } }),
      prisma.contract_types.findFirst({ where: { is_active: true } }),
      prisma.document_checklists.findFirst({
        where: { is_active: true, deleted_at: null },
      }),
      prisma.roles.findUnique({ where: { name: "Staf" } }),
      prisma.divisions.findFirst({ orderBy: { created_at: "asc" } }),
    ]);
    assert.ok(product, "Produk pembiayaan aktif wajib tersedia.");
    assert.ok(contractType, "Jenis akad aktif wajib tersedia.");
    assert.ok(checklist, "Checklist dokumen aktif wajib tersedia.");
    assert.ok(staffRole, "Role Staf wajib tersedia.");
    assert.ok(division, "Divisi baseline wajib tersedia.");

    const suffix = fixture.runId.replace(/-/g, "").slice(0, 10);
    const debtor = await prisma.digital_debtors.create({
      data: {
        debtor_number: `IT-FILE-${suffix}`,
        name: fixture.name("Debitur File Operasional"),
        customer_type: "INDIVIDUAL",
        status: "ACTIVE",
        created_by: admin.id,
      },
    });
    fixture.track("debtor", debtor.id);
    const contract = await prisma.debtor_contracts.create({
      data: {
        no_kontrak: `IT-FILE-CONTRACT-${suffix}`,
        debtor_id: debtor.id,
        product_id: product.id,
        akad_type_id: contractType.id,
        tanggal_akad: new Date(),
        plafond: 10000000,
        pokok: 10000000,
        margin: 1000000,
        tenor: 12,
        outstanding_pokok: 9000000,
        outstanding_margin: 900000,
        status: "ACTIVE",
        created_by: admin.id,
      },
    });
    fixture.track("contract", contract.id);
    const outsider = await createActiveUser(prisma, fixture, {
      username: `it_debtor_outsider_${suffix}`,
      roleId: staffRole.id,
      divisionId: division.id,
      name: fixture.name("Staf Luar Scope Debitur"),
    });
    const login = await loginAgent(agent, credentials, fixture.userAgent);
    accessToken = login.accessToken;
    const outsiderLogin = await loginAgent(
      outsiderAgent,
      { username: outsider.username, password: outsider.password },
      fixture.userAgent,
    );
    outsiderAccessToken = outsiderLogin.accessToken;
    const now = new Date().toISOString();

    const documentCreated = await agent
      .post(`/api/v1/debtors/${debtor.id}/documents`)
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("contract_id", contract.id)
      .field("document_checklist_id", checklist.id)
      .field("document_type", checklist.document_type || "DOKUMEN")
      .field("category", checklist.category || "LAINNYA")
      .field("description", "Dokumen debitur integration test")
      .attach("files", PDF, {
        filename: "dokumen-debitur.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    const documentId = documentCreated.body.data?.id;
    assert.equal(typeof documentId, "string");
    fixture.track("debtorDocument", documentId);
    const documentFile = documentCreated.body.data.files?.[0];
    storedPaths.add(documentFile.path);
    await verifyPrivatePdf(app, documentFile, { verifyUnsigned: true });
    const documentList = await agent
      .get(`/api/v1/debtors/${debtor.id}/documents`)
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .expect(200);
    assert.ok(documentList.body.data.some((item) => item.id === documentId));

    const marketingCreated = await agent
      .post("/api/v1/debtor-marketing/action-plans")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("debtor_id", debtor.id)
      .field("contract_id", contract.id)
      .field("activity_date", now)
      .field("target_date", now)
      .field("status", "PENDING")
      .field("action_plan", "Rencana tindak lanjut integration test")
      .field("notes", "Tidak menggunakan data geolocation")
      .attach("files", PDF, {
        filename: "rencana-tindak-lanjut.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    const marketingId = marketingCreated.body.data?.id;
    assert.equal(typeof marketingId, "string");
    fixture.track("marketingActivity", marketingId);
    fixture.track("marketingTimeline", marketingCreated.body.data.timeline_id);
    const marketingFile = marketingCreated.body.data.files?.[0];
    storedPaths.add(marketingFile.path);
    await verifyPrivatePdf(app, marketingFile);
    const marketingUpdated = await agent
      .put(`/api/v1/debtor-marketing/action-plans/${marketingId}`)
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("status", "COMPLETED")
      .field("action_plan", "Rencana tindak lanjut selesai")
      .expect(200);
    assert.equal(marketingUpdated.body.data.status, "COMPLETED");

    const debtorWorkflow = await agent
      .get(`/api/v1/debtors/${debtor.id}/workflow`)
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .expect(200);
    const workflowEntry = debtorWorkflow.body.data?.marketing?.timeline?.entries?.find(
      (item) => item.id === marketingId,
    );
    assert.ok(workflowEntry, "Aktivitas wajib tersedia pada timeline debitur.");
    assert.equal(workflowEntry.created_by, admin.id);
    assert.deepEqual(
      {
        id: workflowEntry.creator?.id,
        name: workflowEntry.creator?.name,
        username: workflowEntry.creator?.username,
      },
      {
        id: admin.id,
        name: admin.name,
        username: admin.username,
      },
      "Timeline wajib menyertakan identitas pembuat yang dapat ditampilkan, bukan hanya UUID.",
    );

    const warningCreated = await agent
      .post("/api/v1/debtor-warning-letters")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("debtor_id", debtor.id)
      .field("contract_id", contract.id)
      .field("letter_type", "SP1")
      .field("issued_at", now)
      .field("delivery_status", "BELUM_DIKIRIM")
      .field("description", "Surat peringatan integration test")
      .attach("files", PDF, {
        filename: "surat-peringatan-sp1.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    const warningId = warningCreated.body.data?.id;
    assert.equal(typeof warningId, "string");
    fixture.track("warningLetter", warningId);
    const warningFile = warningCreated.body.data.files?.[0];
    storedPaths.add(warningFile.path);
    await verifyPrivatePdf(app, warningFile);
    const warningUpdated = await agent
      .put(`/api/v1/debtor-warning-letters/${warningId}`)
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("delivery_status", "TERKIRIM")
      .field("sent_at", now)
      .expect(200);
    assert.equal(warningUpdated.body.data.delivery_status, "TERKIRIM");

    for (const path of [
      `/api/v1/debtors/${debtor.id}`,
      `/api/v1/debtor-contracts/${contract.id}`,
      `/api/v1/debtors/${debtor.id}/documents`,
      `/api/v1/debtor-marketing/action-plans/${marketingId}`,
      `/api/v1/debtor-warning-letters/${warningId}`,
    ]) {
      await outsiderAgent
        .get(path)
        .set("User-Agent", fixture.userAgent)
        .set(outsiderLogin.authorization)
        .expect(404);
    }
    await outsiderAgent
      .put(`/api/v1/debtor-warning-letters/${warningId}`)
      .set("User-Agent", fixture.userAgent)
      .set(outsiderLogin.authorization)
      .field("delivery_status", "TERKIRIM")
      .expect(404);

    await agent
      .delete(`/api/v1/debtor-marketing/action-plans/${marketingId}`)
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .expect(200);
    await agent
      .delete(`/api/v1/debtor-warning-letters/${warningId}`)
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .expect(200);
    assert.ok(
      (
        await prisma.debtor_marketing_activities.findUnique({
          where: { id: marketingId },
        })
      ).deleted_at,
    );
    assert.ok(
      (
        await prisma.debtor_warning_letters.findUnique({
          where: { id: warningId },
        })
      ).deleted_at,
    );

    const auditRows = await prisma.debtor_activity_logs.findMany({
      where: {
        OR: [
          { document_id: documentId },
          { marketing_activity_id: marketingId },
          { warning_letter_id: warningId },
        ],
      },
    });
    assert.ok(auditRows.length >= 7);
    assert.ok(auditRows.every((item) => item.actor_id === admin.id));
  },
);
