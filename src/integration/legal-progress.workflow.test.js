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

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  "utf8",
);

function signedPath(fileUrl) {
  const parsed = new URL(fileUrl);
  return `${parsed.pathname}${parsed.search}`;
}

function collectPaths(responseData, storedPaths) {
  for (const file of responseData?.files || []) {
    if (file.path) storedPaths.add(file.path);
  }
}

async function assertDownload(app, file) {
  assert.ok(file?.url, "URL file legal bertanda tangan wajib tersedia.");
  const response = await request(app)
    .get(signedPath(file.url))
    .expect("Cache-Control", /private, no-store/)
    .expect("Content-Type", /application\/pdf/)
    .expect(200);
  assert.ok(Buffer.isBuffer(response.body));
  assert.equal(response.body.subarray(0, 4).toString("utf8"), "%PDF");
}

test(
  "notaris, asuransi, KJPP, dan klaim menjalani CRUD valid dengan file nyata",
  { skip: process.env.RUN_CRITICAL_DB_INTEGRATION !== "true" },
  async (t) => {
    const app = require("../app");
    const prisma = require("../config/prisma-system");
    const fixture = createIntegrationFixture(prisma, "Legal progress workflow");
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
    const [product, contractType, staffRole, division] = await Promise.all([
      prisma.financing_products.findFirst({ where: { is_active: true } }),
      prisma.contract_types.findFirst({ where: { is_active: true } }),
      prisma.roles.findUnique({ where: { name: "Staf" } }),
      prisma.divisions.findFirst({ orderBy: { created_at: "asc" } }),
    ]);
    assert.ok(product, "Produk pembiayaan aktif wajib tersedia.");
    assert.ok(contractType, "Jenis akad aktif wajib tersedia.");
    assert.ok(staffRole, "Role Staf wajib tersedia.");
    assert.ok(division, "Divisi baseline wajib tersedia.");

    const suffix = fixture.runId.replace(/-/g, "").slice(0, 10);
    const thirdParties = {};
    for (const category of ["NOTARY", "INSURANCE", "KJPP"]) {
      const thirdParty = await prisma.third_parties.create({
        data: {
          code: `IT-${category}-${suffix}`,
          name: fixture.name(`Pihak Ketiga ${category}`),
          category,
          is_active: true,
          created_by: admin.id,
        },
      });
      fixture.track("thirdParty", thirdParty.id);
      thirdParties[category] = thirdParty;
    }
    const notary = thirdParties.NOTARY;
    const insurance = thirdParties.INSURANCE;
    const kjpp = thirdParties.KJPP;
    const outsider = await createActiveUser(prisma, fixture, {
      username: `it_legal_outsider_${suffix}`,
      roleId: staffRole.id,
      divisionId: division.id,
      name: fixture.name("Staf Luar Scope Legal"),
    });
    const debtor = await prisma.digital_debtors.create({
      data: {
        debtor_number: `IT-LGL-${suffix}`,
        name: fixture.name("Debitur Legal Progress"),
        customer_type: "INDIVIDUAL",
        status: "ACTIVE",
        created_by: admin.id,
      },
    });
    fixture.track("debtor", debtor.id);
    const contract = await prisma.debtor_contracts.create({
      data: {
        no_kontrak: `IT-LGL-CONTRACT-${suffix}`,
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
    const collateral = await prisma.debtor_collaterals.create({
      data: {
        debtor_id: debtor.id,
        contract_id: contract.id,
        collateral_number: `IT-LGL-COLL-${suffix}`,
        collateral_type: "SHGB",
        owner_name: fixture.name("Pemilik Agunan Legal"),
        proof_number: `IT-LGL-PROOF-${suffix}`,
        address: "Lokasi agunan integration test",
        market_value: 500000000,
        appraisal_value: 475000000,
        period_month: "202607",
        created_by: admin.id,
      },
    });
    fixture.track("collateral", collateral.id);

    const login = await loginAgent(agent, credentials, fixture.userAgent);
    accessToken = login.accessToken;
    const outsiderLogin = await loginAgent(
      outsiderAgent,
      { username: outsider.username, password: outsider.password },
      fixture.userAgent,
    );
    outsiderAccessToken = outsiderLogin.accessToken;
    const now = new Date().toISOString();
    const estimated = futureUtcDate({ days: 14 }).toISOString();
    const completed = futureUtcDate({ days: 1 }).toISOString();

    const notaryCreated = await agent
      .post("/api/v1/legal/progress/notary")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("contract_id", contract.id)
      .field("collateral_id", collateral.id)
      .field("third_party_id", notary.id)
      .field("deed_type", "APHT")
      .field("received_at", now)
      .field("estimated_completed_at", estimated)
      .field("status", "PROSES")
      .field("notes", "Progress notaris integration test")
      .attach("files", PDF, {
        filename: "progress-notaris.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    const notaryId = notaryCreated.body.data?.id;
    assert.equal(typeof notaryId, "string");
    fixture.track("legalNotary", notaryId);
    collectPaths(notaryCreated.body.data, storedPaths);
    assert.equal(notaryCreated.body.data.files.length, 1);
    await request(app)
      .get(new URL(notaryCreated.body.data.files[0].url).pathname)
      .expect(401);
    await assertDownload(app, notaryCreated.body.data.files[0]);

    const notaryUpdated = await agent
      .put(`/api/v1/legal/progress/notary/${notaryId}`)
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("status", "SELESAI")
      .field("completed_at", completed)
      .field("deed_number", `IT-AKTA-${suffix}`)
      .expect(200);
    assert.equal(notaryUpdated.body.data.status, "SELESAI");
    assert.equal(notaryUpdated.body.data.deed_number, `IT-AKTA-${suffix}`);

    const insuranceCreated = await agent
      .post("/api/v1/legal/progress/insurance")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("contract_id", contract.id)
      .field("collateral_id", collateral.id)
      .field("third_party_id", insurance.id)
      .field("insurance_type", "AGUNAN")
      .field("coverage_amount", "750000000")
      .field("premium_amount", "3500000")
      .field("period_start", now)
      .field("period_end", futureUtcDate({ years: 1 }).toISOString())
      .field("policy_number", `IT-POLIS-${suffix}`)
      .field("status", "AKTIF")
      .field("notes", "Progress asuransi integration test")
      .attach("files", PDF, {
        filename: "progress-asuransi.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    const insuranceId = insuranceCreated.body.data?.id;
    assert.equal(typeof insuranceId, "string");
    fixture.track("legalInsurance", insuranceId);
    collectPaths(insuranceCreated.body.data, storedPaths);
    await assertDownload(app, insuranceCreated.body.data.files[0]);
    const insuranceUpdated = await agent
      .put(`/api/v1/legal/progress/insurance/${insuranceId}`)
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("status", "KLAIM")
      .field("notes", "Status asuransi diperbarui melalui transaksi valid")
      .attach("files", PDF, {
        filename: "lampiran-asuransi-tambahan.pdf",
        contentType: "application/pdf",
      })
      .expect(200);
    collectPaths(insuranceUpdated.body.data, storedPaths);
    assert.equal(insuranceUpdated.body.data.status, "KLAIM");
    assert.equal(insuranceUpdated.body.data.files.length, 2);
    await assertDownload(app, insuranceUpdated.body.data.files[1]);

    const kjppCreated = await agent
      .post("/api/v1/legal/progress/kjpp")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("contract_id", contract.id)
      .field("collateral_id", collateral.id)
      .field("third_party_id", kjpp.id)
      .field("appraisal_type", "REVIEW_APPRAISAL")
      .field("received_at", now)
      .field("estimated_completed_at", estimated)
      .field("status", "PROSES")
      .field("collateral_object", collateral.collateral_number)
      .field("appraisal_value", "825000000")
      .field("notes", "Progress KJPP integration test")
      .attach("files", PDF, {
        filename: "progress-kjpp.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    const kjppId = kjppCreated.body.data?.id;
    assert.equal(typeof kjppId, "string");
    fixture.track("legalKjpp", kjppId);
    collectPaths(kjppCreated.body.data, storedPaths);
    await assertDownload(app, kjppCreated.body.data.files[0]);
    const kjppUpdated = await agent
      .put(`/api/v1/legal/progress/kjpp/${kjppId}`)
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("status", "SELESAI")
      .field("completed_at", completed)
      .field("report_number", `IT-KJPP-${suffix}`)
      .expect(200);
    assert.equal(kjppUpdated.body.data.status, "SELESAI");

    const claimCreated = await agent
      .post("/api/v1/legal/claims")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("contract_id", contract.id)
      .field("collateral_id", collateral.id)
      .field("insurance_progress_id", insuranceId)
      .field("policy_number", `IT-POLIS-${suffix}`)
      .field("claim_type", "KLAIM_KEBAKARAN")
      .field("claim_amount", "25000000")
      .field("submitted_at", now)
      .field("status", "PENGAJUAN")
      .field("notes", "Klaim integration test")
      .attach("files", PDF, {
        filename: "dokumen-klaim.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    const claimId = claimCreated.body.data?.id;
    assert.equal(typeof claimId, "string");
    fixture.track("legalClaim", claimId);
    collectPaths(claimCreated.body.data, storedPaths);
    await assertDownload(app, claimCreated.body.data.files[0]);
    const claimUpdated = await agent
      .put(`/api/v1/legal/claims/${claimId}`)
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("status", "DISETUJUI")
      .field("approved_amount", "20000000")
      .field("notes", "Klaim disetujui integration test")
      .expect(200);
    assert.equal(claimUpdated.body.data.status, "DISETUJUI");
    assert.equal(claimUpdated.body.data.approved_amount, 20000000);

    const listChecks = [
      ["/api/v1/legal/progress/notary", notaryId],
      ["/api/v1/legal/progress/insurance", insuranceId],
      ["/api/v1/legal/progress/kjpp", kjppId],
      ["/api/v1/legal/claims", claimId],
    ];
    for (const [path, id] of listChecks) {
      const listed = await agent
        .get(`${path}?page=1&limit=100`)
        .set("User-Agent", fixture.userAgent)
        .set(login.authorization)
        .expect(200);
      assert.ok(listed.body.data.some((item) => item.id === id));
      const outsiderList = await outsiderAgent
        .get(`${path}?page=1&limit=100`)
        .set("User-Agent", fixture.userAgent)
        .set(outsiderLogin.authorization)
        .expect(200);
      assert.equal(
        outsiderList.body.data.some((item) => item.id === id),
        false,
      );
    }

    for (const path of [
      `/api/v1/legal/progress/notary/${notaryId}`,
      `/api/v1/legal/progress/insurance/${insuranceId}`,
      `/api/v1/legal/progress/kjpp/${kjppId}`,
      `/api/v1/legal/claims/${claimId}`,
    ]) {
      await outsiderAgent
        .put(path)
        .set("User-Agent", fixture.userAgent)
        .set(outsiderLogin.authorization)
        .field("notes", "Percobaan update di luar scope")
        .expect(404);
    }

    for (const reportPath of [
      "/api/v1/legal/reports/summary",
      "/api/v1/legal/reports/third-party-documents",
      "/api/v1/legal/reports/third-party-deposit-funds",
      "/api/v1/legal/reports/activity-logs?page=1&limit=100",
    ]) {
      await agent
        .get(reportPath)
        .set("User-Agent", fixture.userAgent)
        .set(login.authorization)
        .expect(200);
    }

    const deletes = [
      [`/api/v1/legal/claims/${claimId}`, "legal_claims", claimId],
      [`/api/v1/legal/progress/notary/${notaryId}`, "legal_notary_progress", notaryId],
      [
        `/api/v1/legal/progress/insurance/${insuranceId}`,
        "legal_insurance_progress",
        insuranceId,
      ],
      [`/api/v1/legal/progress/kjpp/${kjppId}`, "legal_kjpp_progress", kjppId],
    ];
    for (const [path, model, id] of deletes) {
      await agent
        .delete(path)
        .set("User-Agent", fixture.userAgent)
        .set(login.authorization)
        .expect(200);
      const stored = await prisma[model].findUnique({ where: { id } });
      assert.ok(stored.deleted_at);
      assert.equal(stored.deleted_by, admin.id);
    }

    const legalActions = await prisma.legal_activity_logs.findMany({
      where: {
        user_agent: fixture.userAgent,
        entity_id: { in: [notaryId, insuranceId, kjppId, claimId] },
      },
      orderBy: { created_at: "asc" },
      select: { action: true, actor_id: true },
    });
    assert.equal(legalActions.length, 12);
    assert.ok(legalActions.every((item) => item.actor_id === admin.id));
    assert.deepEqual(
      legalActions.reduce((counts, item) => {
        counts[item.action] = (counts[item.action] || 0) + 1;
        return counts;
      }, {}),
      { CREATE: 4, UPDATE: 4, DELETE: 4 },
    );
  },
);
