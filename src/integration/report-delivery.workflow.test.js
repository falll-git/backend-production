const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");
const ExcelJS = require("exceljs");

const { loadEnv } = require("../config/env");

loadEnv();

const {
  createIntegrationFixture,
  loginAgent,
  readAdminCredentials,
} = require("./support/integration-test-helpers");

function binaryParser(response, callback) {
  const chunks = [];
  response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
}

test(
  "export log aktivitas dan cetak resume iDeb mengirim file valid",
  { skip: process.env.RUN_CRITICAL_DB_INTEGRATION !== "true" },
  async (t) => {
    const app = require("../app");
    const prisma = require("../config/prisma");
    const fixture = createIntegrationFixture(prisma, "Report delivery workflow");
    const agent = request.agent(app);
    const credentials = readAdminCredentials();
    let accessToken = null;

    t.after(async () => {
      if (accessToken) {
        await agent
          .post("/api/v1/auth/logout")
          .set("User-Agent", fixture.userAgent)
          .set("Authorization", `Bearer ${accessToken}`)
          .catch(() => {});
      }
      await fixture.cleanup();
      await prisma.$disconnect();
    });

    const admin = await prisma.users.findUnique({
      where: { username: credentials.username.toLowerCase() },
    });
    assert.ok(admin, "Admin integration test wajib tersedia.");
    const suffix = fixture.runId.replace(/-/g, "").slice(0, 10);
    const debtor = await prisma.digital_debtors.create({
      data: {
        debtor_number: `IT-OUT-${suffix}`,
        identity_number: `3275${suffix.padEnd(12, "0").slice(0, 12)}`,
        name: fixture.name("Debitur Resume iDeb"),
        customer_type: "INDIVIDUAL",
        status: "ACTIVE",
        created_by: admin.id,
      },
    });
    fixture.track("debtor", debtor.id);
    const idebUpload = await prisma.debtor_ideb_uploads.create({
      data: {
        debtor_id: debtor.id,
        source_fingerprint: `integration-${fixture.runId}`,
        month: 7,
        year: 2026,
        status: "COMPLETED",
        result_summary: {
          schema_version: "ideb-v1",
          period_month: "2026-07",
          debtor_number: debtor.debtor_number,
          debtor_name: debtor.name,
          identity_number: debtor.identity_number,
          facilities: [
            {
              reporter_name: "Pelapor Integration",
              account_number: `IT-REK-${suffix}`,
              credit_type: "Pembiayaan",
              condition_code: "00",
              collectibility: "1",
              days_past_due: 0,
              plafond: 10000000,
              outstanding: 9000000,
              period_month: "2026-07",
              history: [
                {
                  period_month: "2026-07",
                  collectibility: "1",
                  days_past_due: 0,
                },
              ],
            },
          ],
        },
        file_path: `/api/digital-archive-files/integration/ideb-${suffix}.txt`,
        file_name: `ideb-${suffix}.txt`,
        mime_type: "text/plain",
        size_bytes: 128,
        uploaded_by: admin.id,
        created_by: admin.id,
      },
    });
    fixture.track("idebUpload", idebUpload.id);

    const login = await loginAgent(agent, credentials, fixture.userAgent);
    accessToken = login.accessToken;

    const exportResponse = await agent
      .get("/api/v1/activity-centre/export")
      .query({ date_from: "2026-01-01", date_to: "2026-12-31" })
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .buffer(true)
      .parse(binaryParser)
      .expect(
        "Content-Type",
        /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
      )
      .expect("Content-Disposition", /attachment; filename=".+\.xlsx"/)
      .expect(200);
    assert.ok(Buffer.isBuffer(exportResponse.body));
    assert.equal(exportResponse.body.subarray(0, 2).toString("utf8"), "PK");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportResponse.body);
    assert.ok(workbook.worksheets.length > 0);
    assert.ok(workbook.worksheets[0].rowCount >= 1);

    const pdfResponse = await agent
      .get(`/api/v1/debtor-imports/ideb/${idebUpload.id}/resume-pdf`)
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .buffer(true)
      .parse(binaryParser)
      .expect("Content-Type", /application\/pdf/)
      .expect("Content-Disposition", /attachment; filename=".+\.pdf"/)
      .expect(200);
    assert.ok(Buffer.isBuffer(pdfResponse.body));
    assert.equal(pdfResponse.body.subarray(0, 4).toString("utf8"), "%PDF");
    assert.ok(pdfResponse.body.length > 1000);
  },
);
