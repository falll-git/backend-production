const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

const { loadEnv } = require("../config/env");

loadEnv();

const { deleteStoredFile } = require("../utils/digital-archive-files");
const {
  createIntegrationFixture,
  loginAgent,
  readAdminCredentials,
  waitFor,
} = require("./support/integration-test-helpers");

function buildA01File({ collateralNumber, contractNumber, debtorNumber }) {
  const data = [
    "D",
    collateralNumber,
    contractNumber,
    debtorNumber,
    "F01",
    "1",
    "SHGB",
    "",
    "",
    "HT",
    "20260115",
    "Pemilik hasil import A01",
    "BUKTI-A01",
    "Lokasi hasil import A01",
    "3275",
    "500000000",
    "475000000",
    "20260701",
    "460000000",
    "KJPP Integration",
    "20260702",
    "Y",
    "100",
    "N",
    "Y",
    "Agunan hasil import integration",
    "001",
    "U",
  ];
  assert.equal(data.length, 28, "Baris A01 wajib berisi D dan 27 field data.");
  return Buffer.from(
    ["H|0104|620005|2026|07|A01|1", data.join("|")].join("\n"),
    "utf8",
  );
}

test(
  "upload SLIK A01 dan IDEB valid diproses sampai database tanpa menghapus data manual agunan",
  { skip: process.env.RUN_CRITICAL_DB_INTEGRATION !== "true" },
  async (t) => {
    const previousQueueEnabled = process.env.SLIK_IMPORT_QUEUE_ENABLED;
    const previousFallbackEnabled = process.env.SLIK_IMPORT_LOCAL_FALLBACK_ENABLED;
    process.env.SLIK_IMPORT_QUEUE_ENABLED = "false";
    process.env.SLIK_IMPORT_LOCAL_FALLBACK_ENABLED = "true";

    const app = require("../app");
    const prisma = require("../config/prisma-system");
    const fixture = createIntegrationFixture(prisma, "Import upload workflow");
    const agent = request.agent(app);
    const credentials = readAdminCredentials();
    const storedPaths = new Set();
    let accessToken = null;

    t.after(async () => {
      if (accessToken) {
        await agent
          .post("/api/v1/auth/logout")
          .set("User-Agent", fixture.userAgent)
          .set("Authorization", `Bearer ${accessToken}`)
          .catch(() => {});
      }
      const importJobIds = fixture.values("importJob");
      if (importJobIds.length > 0) {
        const [importJobs, idebUploads] = await Promise.all([
          prisma.debtor_import_jobs.findMany({
            where: { id: { in: importJobIds } },
            select: { file_path: true },
          }),
          prisma.debtor_ideb_uploads.findMany({
            where: { import_job_id: { in: importJobIds } },
            include: { files: { select: { file_path: true } } },
          }),
        ]);
        for (const importJob of importJobs) {
          if (importJob.file_path) storedPaths.add(importJob.file_path);
        }
        for (const upload of idebUploads) {
          if (upload.file_path) storedPaths.add(upload.file_path);
          for (const file of upload.files) {
            if (file.file_path) storedPaths.add(file.file_path);
          }
        }
      }
      await fixture.cleanup();
      for (const storedPath of storedPaths) deleteStoredFile(storedPath);
      if (previousQueueEnabled === undefined) delete process.env.SLIK_IMPORT_QUEUE_ENABLED;
      else process.env.SLIK_IMPORT_QUEUE_ENABLED = previousQueueEnabled;
      if (previousFallbackEnabled === undefined) {
        delete process.env.SLIK_IMPORT_LOCAL_FALLBACK_ENABLED;
      } else {
        process.env.SLIK_IMPORT_LOCAL_FALLBACK_ENABLED = previousFallbackEnabled;
      }
      await prisma.$disconnect();
    });

    const admin = await prisma.users.findUnique({
      where: { username: credentials.username.toLowerCase() },
    });
    assert.ok(admin, "Admin integration test wajib tersedia.");
    const [product, contractType] = await Promise.all([
      prisma.financing_products.findFirst({ where: { is_active: true } }),
      prisma.contract_types.findFirst({ where: { is_active: true } }),
    ]);
    assert.ok(product, "Produk pembiayaan aktif wajib tersedia.");
    assert.ok(contractType, "Jenis akad aktif wajib tersedia.");

    const suffix = fixture.runId.replace(/-/g, "").slice(0, 10);
    const debtor = await prisma.digital_debtors.create({
      data: {
        debtor_number: `IT-IMP-${suffix}`,
        identity_number: `3275${suffix.padEnd(12, "0").slice(0, 12)}`,
        name: fixture.name("Debitur Import"),
        customer_type: "INDIVIDUAL",
        status: "ACTIVE",
        created_by: admin.id,
      },
    });
    fixture.track("debtor", debtor.id);
    const contract = await prisma.debtor_contracts.create({
      data: {
        no_kontrak: `IT-IMP-CONTRACT-${suffix}`,
        debtor_id: debtor.id,
        product_id: product.id,
        akad_type_id: contractType.id,
        tanggal_akad: new Date("2026-01-15T00:00:00.000Z"),
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
    const expiryDate = new Date("2027-01-31T00:00:00.000Z");
    const expiryNote = fixture.name("Keterangan expired manual");
    const collateral = await prisma.debtor_collaterals.create({
      data: {
        debtor_id: debtor.id,
        contract_id: contract.id,
        collateral_number: `IT-IMP-COLL-${suffix}`,
        facility_number: contract.no_kontrak,
        collateral_type: "SHGB",
        owner_name: "Pemilik sebelum import",
        proof_number: `IT-IMP-PROOF-${suffix}`,
        period_month: "2026-06",
        has_expiry_date: true,
        expiry_date: expiryDate,
        expiry_note: expiryNote,
        expiry_updated_by: admin.id,
        expiry_updated_at: new Date("2026-07-01T00:00:00.000Z"),
        created_by: admin.id,
      },
    });
    fixture.track("collateral", collateral.id);

    const login = await loginAgent(agent, credentials, fixture.userAgent);
    accessToken = login.accessToken;
    const a01File = buildA01File({
      collateralNumber: collateral.collateral_number,
      contractNumber: contract.no_kontrak,
      debtorNumber: debtor.debtor_number,
    });
    const slikResponse = await agent
      .post("/api/v1/debtor-imports/slik")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("import_segment", "A01")
      .field("period_month", "2026-07")
      .attach("files", a01File, {
        filename: "0104.620005.2026.07.A01.1.txt",
        contentType: "text/plain",
      })
      .expect((response) => {
        assert.equal(
          response.status,
          201,
          `Upload SLIK gagal: ${JSON.stringify(response.body)}`,
        );
      });
    fixture.track("importJob", slikResponse.body.data.id);

    const completedSlik = await waitFor(
      async () => {
        const job = await prisma.debtor_import_jobs.findUnique({
          where: { id: slikResponse.body.data.id },
        });
        return ["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"].includes(job?.status)
          ? job
          : null;
      },
      { intervalMs: 50, timeoutMs: 10000 },
    );
    assert.ok(completedSlik, "Job SLIK harus mencapai status terminal.");
    assert.equal(completedSlik.status, "COMPLETED");
    assert.equal(completedSlik.success_rows, 1);
    assert.equal(completedSlik.failed_rows, 0);
    storedPaths.add(completedSlik.file_path);

    const collateralAfterImport = await prisma.debtor_collaterals.findUnique({
      where: { id: collateral.id },
    });
    assert.equal(collateralAfterImport.owner_name, "Pemilik hasil import A01");
    assert.equal(collateralAfterImport.period_month, "2026-07");
    assert.equal(collateralAfterImport.has_expiry_date, true);
    assert.equal(collateralAfterImport.expiry_date.toISOString(), expiryDate.toISOString());
    assert.equal(collateralAfterImport.expiry_note, expiryNote);
    assert.equal(collateralAfterImport.expiry_updated_by, admin.id);
    assert.equal(
      collateralAfterImport.expiry_updated_at.toISOString(),
      "2026-07-01T00:00:00.000Z",
    );

    const idebPayload = {
      schema_version: "ideb-v1",
      source_format: "IDEB_JSON",
      periode: "2026-07",
      report_number: `IT-IDEB-REPORT-${suffix}`,
      reference_number: `IT-IDEB-REF-${suffix}`,
      result_date: "20260715",
      debitur: {
        no_cif: debtor.debtor_number,
        no_identitas: debtor.identity_number,
        nama: debtor.name,
      },
      ringkasan: {
        kolektibilitas_terburuk: "1",
        total_baki_debet: 9000000,
        kesimpulan: "Riwayat pembayaran integration test",
      },
      fasilitas: [
        {
          no_rekening: contract.no_kontrak,
          nama_pelapor: "Pelapor Integration",
          jenis_kredit: "Pembiayaan",
          kondisi_kode: "00",
          kol: "1",
          hari_tunggakan: 0,
          plafon: 10000000,
          baki_debet: 9000000,
        },
      ],
    };
    const idebBuffer = Buffer.from(JSON.stringify(idebPayload), "utf8");
    const idebResponse = await agent
      .post("/api/v1/debtor-imports/ideb")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("debtor_id", debtor.id)
      .field("contract_id", contract.id)
      .field("period_month", "2026-07")
      .attach("files", idebBuffer, {
        filename: `ideb-${suffix}.json`,
        contentType: "application/json",
      })
      .expect(201);
    fixture.track("importJob", idebResponse.body.data.id);

    const storedIdeb = await prisma.debtor_ideb_uploads.findFirst({
      where: { import_job_id: idebResponse.body.data.id },
      include: { files: true },
    });
    assert.ok(storedIdeb, "Upload IDEB wajib tersimpan.");
    storedPaths.add(storedIdeb.file_path);
    for (const file of storedIdeb.files) storedPaths.add(file.file_path);
    assert.equal(storedIdeb.debtor_id, debtor.id);
    assert.equal(storedIdeb.contract_id, contract.id);
    assert.equal(storedIdeb.month, 7);
    assert.equal(storedIdeb.year, 2026);
    assert.equal(storedIdeb.result_summary.period_month, "2026-07");
    assert.equal(storedIdeb.result_summary.identity_number, debtor.identity_number);

    const externalRecord = await prisma.debtor_external_records.findFirst({
      where: { import_job_id: idebResponse.body.data.id },
    });
    assert.ok(externalRecord, "External record IDEB wajib tersimpan.");
    assert.equal(externalRecord.status, "MATCHED");

    await agent
      .post("/api/v1/debtor-imports/ideb")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("debtor_id", debtor.id)
      .field("contract_id", contract.id)
      .field("period_month", "2026-07")
      .attach("files", idebBuffer, {
        filename: `ideb-${suffix}-duplicate.json`,
        contentType: "application/json",
      })
      .expect(409);
  },
);
