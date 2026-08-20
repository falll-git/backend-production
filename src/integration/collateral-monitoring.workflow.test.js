const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");
const ExcelJS = require("exceljs");

const { loadEnv } = require("../config/env");

loadEnv();

const { buildCollateralImportUpdateData } = require("../utils/slik-collateral-import");
const {
  createIntegrationFixture,
  futureUtcDate,
  loginAgent,
  readAdminCredentials,
  waitFor,
} = require("./support/integration-test-helpers");

function binaryParser(response, callback) {
  const chunks = [];
  response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
}

test(
  "monitoring expired agunan tersimpan per record dan bertahan pada merge A01",
  { skip: process.env.RUN_CRITICAL_DB_INTEGRATION !== "true" },
  async (t) => {
    const app = require("../app");
    const prisma = require("../config/prisma-system");
    const fixture = createIntegrationFixture(prisma, "Collateral monitoring workflow");
    const agent = request.agent(app);
    const credentials = readAdminCredentials();
    let accessToken = null;

    t.after(async () => {
      if (accessToken) {
        await agent
          .post("/api/v1/auth/logout")
          .set("User-Agent", fixture.userAgent)
          .set("Authorization", `Bearer ${accessToken}`);
      }
      await fixture.cleanup();
      await prisma.$disconnect();
    });

    const admin = await prisma.users.findUnique({
      where: { username: credentials.username.toLowerCase() },
    });
    assert.ok(admin, "Admin integration test harus tersedia pada database.");

    const debtor = await prisma.digital_debtors.create({
      data: {
        debtor_number: `IT-DEBTOR-${fixture.runId.slice(0, 8)}`,
        name: fixture.name("Debitur Agunan"),
        status: "ACTIVE",
        customer_type: "INDIVIDUAL",
        created_by: admin.id,
      },
    });
    fixture.track("debtor", debtor.id);

    const reporterAppraisalDate = futureUtcDate({ months: -11 });
    const collateral = await prisma.debtor_collaterals.create({
      data: {
        debtor_id: debtor.id,
        collateral_number: `IT-AGUNAN-${fixture.runId.slice(0, 8)}`,
        collateral_type: "SHGB",
        owner_name: fixture.name("Pemilik"),
        proof_number: `BUKTI-${fixture.runId.slice(0, 8)}`,
        address: "Lokasi fixture integration",
        market_value: 500000000,
        appraisal_value: 475000000,
        reporter_appraisal_date: reporterAppraisalDate,
        description: "Fixture monitoring agunan",
        period_month: "202607",
        last_import_period_month: "202607",
        created_by: admin.id,
      },
    });
    fixture.track("collateral", collateral.id);

    const login = await loginAgent(agent, credentials, fixture.userAgent);
    accessToken = login.accessToken;
    const expiryDate = futureUtcDate({ months: 2 });
    const expiryDateOnly = expiryDate.toISOString().slice(0, 10);
    const note = fixture.name("Perpanjangan sedang diproses");

    const templateResponse = await agent
      .get("/api/v1/debtors/collaterals/expiry-template")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .buffer(true)
      .parse(binaryParser)
      .expect(
        "Content-Type",
        /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
      )
      .expect("Content-Disposition", /template-update-expired-agunan\.xlsx/)
      .expect(200);
    assert.ok(Buffer.isBuffer(templateResponse.body));
    assert.equal(templateResponse.body.subarray(0, 2).toString("utf8"), "PK");
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Update Expired");
    worksheet.getRow(5).values = [
      "No Register Agunan",
      "Status [YA]/[Tidak]",
      "Tanggal Expired",
      "Keterangan",
    ];
    worksheet.getCell(6, 1).value = collateral.collateral_number;
    worksheet.getCell(6, 2).value = "YA";
    worksheet.getCell(6, 3).value = expiryDateOnly;
    worksheet.getCell(6, 4).value = note;
    const uploadBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const importedResponse = await agent
      .post("/api/v1/debtors/collaterals/expiry-import")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .attach("file", uploadBuffer, {
        filename: "update-expired-agunan.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      .expect(200);
    assert.deepEqual(importedResponse.body.data, {
      total_rows: 1,
      updated_rows: 1,
      status_yes: 1,
      status_no: 0,
    });
    const importedCollateral = await prisma.debtor_collaterals.findUnique({
      where: { id: collateral.id },
    });
    assert.equal(importedCollateral.has_expiry_date, true);
    assert.equal(
      importedCollateral.expiry_date.toISOString().slice(0, 10),
      expiryDateOnly,
    );
    assert.equal(importedCollateral.expiry_note, note);

    const updatedResponse = await agent
      .put(`/api/v1/debtors/collaterals/${collateral.id}/expiry`)
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .send({
        has_expiry_date: true,
        expiry_date: expiryDateOnly,
        expiry_note: note,
      })
      .expect(200);

    assert.equal(updatedResponse.body.data.has_expiry_date, true);
    assert.equal(updatedResponse.body.data.expiry_status, "DUE_SOON");
    assert.equal(updatedResponse.body.data.expiry_status_label, "Segera Berakhir");
    assert.equal(updatedResponse.body.data.appraisal_status, "DUE_SOON");
    assert.equal(updatedResponse.body.data.appraisal_status_label, "Segera Ditinjau Ulang");
    assert.equal(updatedResponse.body.data.latest_appraisal_source, "EXPIRY_DATE");
    assert.equal(
      updatedResponse.body.data.latest_appraisal_date.slice(0, 10),
      expiryDateOnly,
    );

    const storedManual = await prisma.debtor_collaterals.findUnique({
      where: { id: collateral.id },
    });
    assert.equal(storedManual.has_expiry_date, true);
    assert.equal(storedManual.expiry_date.toISOString().slice(0, 10), expiryDateOnly);
    assert.equal(storedManual.expiry_note, note);
    assert.equal(storedManual.expiry_updated_by, admin.id);
    assert.ok(storedManual.expiry_updated_at instanceof Date);

    const simulatedA01Update = buildCollateralImportUpdateData(
      storedManual,
      {
        owner_name: fixture.name("Pemilik dari A01 terbaru"),
        period_month: "202608",
        last_import_period_month: "202608",
        raw_data: { source: "integration-a01-merge" },
      },
      admin.id,
    );
    await prisma.debtor_collaterals.update({
      where: { id: collateral.id },
      data: simulatedA01Update,
    });
    const storedAfterA01Merge = await prisma.debtor_collaterals.findUnique({
      where: { id: collateral.id },
    });
    assert.equal(storedAfterA01Merge.period_month, "202608");
    assert.equal(storedAfterA01Merge.has_expiry_date, true);
    assert.equal(
      storedAfterA01Merge.expiry_date.toISOString().slice(0, 10),
      expiryDateOnly,
    );
    assert.equal(storedAfterA01Merge.expiry_note, note);
    assert.equal(storedAfterA01Merge.expiry_updated_by, admin.id);
    assert.equal(
      storedAfterA01Merge.expiry_updated_at.toISOString(),
      storedManual.expiry_updated_at.toISOString(),
    );

    const listResponse = await agent
      .get("/api/v1/debtors/collaterals")
      .query({ search: collateral.collateral_number })
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .expect(200);
    assert.equal(listResponse.body.meta.total, 1);
    assert.equal(listResponse.body.data[0].id, collateral.id);
    assert.equal(listResponse.body.data[0].expiry_status_label, "Segera Berakhir");

    const disabledResponse = await agent
      .put(`/api/v1/debtors/collaterals/${collateral.id}/expiry`)
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .send({
        has_expiry_date: false,
        expiry_date: null,
        expiry_note: "Tidak memiliki masa berlaku",
      })
      .expect(200);
    assert.equal(disabledResponse.body.data.has_expiry_date, false);
    assert.equal(disabledResponse.body.data.expiry_date, null);
    assert.equal(disabledResponse.body.data.expiry_status, "NOT_APPLICABLE");
    assert.equal(disabledResponse.body.data.expiry_status_label, "Tidak Berlaku");
    assert.equal(disabledResponse.body.data.latest_appraisal_date, null);
    assert.equal(disabledResponse.body.data.appraisal_status_label, "Tidak Berlaku");

    const auditRows = await prisma.debtor_activity_logs.findMany({
      where: {
        entity_id: collateral.id,
        action: "UPDATE_COLLATERAL_EXPIRY",
      },
      orderBy: { created_at: "asc" },
    });
    assert.equal(auditRows.length, 2);
    assert.equal(auditRows[0].actor_id, admin.id);
    assert.equal(auditRows[0].source, "MANUAL");
    assert.equal(auditRows[0].user_agent, fixture.userAgent);

    const bulkAudit = await prisma.debtor_activity_logs.findFirst({
      where: {
        entity_id: collateral.id,
        action: "BULK_UPDATE_COLLATERAL_EXPIRY",
        source: "EXCEL",
        user_agent: fixture.userAgent,
      },
    });
    assert.ok(bulkAudit, "Audit upload Excel expired agunan wajib tersimpan.");

    const systemAuditCount = await waitFor(async () => {
      const count = await prisma.system_activity_logs.count({
        where: {
          user_agent: fixture.userAgent,
          request_path: `/api/v1/debtors/collaterals/${collateral.id}/expiry`,
          action: "UPDATE_COLLATERAL_EXPIRY",
        },
      });
      return count === 2 ? count : 0;
    });
    assert.equal(systemAuditCount, 2);
  },
);
