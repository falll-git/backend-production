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

test(
  "ledger dana titipan legal konsisten dan menolak transaksi melebihi saldo",
  { skip: process.env.RUN_CRITICAL_DB_INTEGRATION !== "true" },
  async (t) => {
    const app = require("../app");
    const prisma = require("../config/prisma-system");
    const fixture = createIntegrationFixture(prisma, "Legal deposit ledger workflow");
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
          .set("Authorization", `Bearer ${accessToken}`);
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
    assert.ok(admin, "Admin integration test harus tersedia pada database.");
    const [product, contractType, staffRole, division] = await Promise.all([
      prisma.financing_products.findFirst({ where: { is_active: true } }),
      prisma.contract_types.findFirst({ where: { is_active: true } }),
      prisma.roles.findUnique({ where: { name: "Staf" } }),
      prisma.divisions.findFirst({ orderBy: { created_at: "asc" } }),
    ]);
    assert.ok(product, "Minimal satu produk pembiayaan aktif wajib tersedia.");
    assert.ok(contractType, "Minimal satu jenis akad aktif wajib tersedia.");
    assert.ok(staffRole, "Role Staf wajib tersedia.");
    assert.ok(division, "Divisi baseline wajib tersedia.");

    const debtor = await prisma.digital_debtors.create({
      data: {
        debtor_number: `IT-LEGAL-${fixture.runId.slice(0, 8)}`,
        name: fixture.name("Debitur Legal"),
        customer_type: "INDIVIDUAL",
        status: "ACTIVE",
        created_by: admin.id,
      },
    });
    fixture.track("debtor", debtor.id);
    const contract = await prisma.debtor_contracts.create({
      data: {
        no_kontrak: `IT-CONTRACT-${fixture.runId.slice(0, 8)}`,
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
    const suffix = fixture.runId.replace(/-/g, "").slice(0, 10);
    const outsider = await createActiveUser(prisma, fixture, {
      username: `it_deposit_outsider_${suffix}`,
      roleId: staffRole.id,
      divisionId: division.id,
      name: fixture.name("Staf Luar Scope Titipan"),
    });

    const login = await loginAgent(agent, credentials, fixture.userAgent);
    accessToken = login.accessToken;
    const outsiderLogin = await loginAgent(
      outsiderAgent,
      { username: outsider.username, password: outsider.password },
      fixture.userAgent,
    );
    outsiderAccessToken = outsiderLogin.accessToken;
    const transactionDate = new Date().toISOString();
    const created = await agent
      .post("/api/v1/legal/deposits")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("type", "ANGSURAN")
      .field("contract_id", contract.id)
      .field("notes", fixture.name("Titipan angsuran"))
      .field(
        "opening_transaction",
        JSON.stringify({
          transaction_date: transactionDate,
          action: "TITIPAN",
          amount: 1000,
          notes: "Saldo awal integration test",
        }),
      )
      .attach("files", PDF, {
        filename: "bukti-titipan-awal.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    const depositId = created.body.data?.id;
    assert.equal(typeof depositId, "string");
    assert.equal(
      created.body.data?.transactions?.[0]?.source,
      "OPENING_BALANCE",
    );
    assert.equal(
      created.body.data?.ledger?.reconciliation?.status,
      "MATCHED",
    );
    fixture.track("legalDeposit", depositId);
    const openingFile = created.body.data?.transactions?.[0]?.files?.[0];
    assert.ok(openingFile?.url, "Bukti transaksi awal wajib tersedia.");
    storedPaths.add(openingFile.path);
    await request(app).get(new URL(openingFile.url).pathname).expect(401);
    await request(app)
      .get(signedPath(openingFile.url))
      .expect("Cache-Control", /private, no-store/)
      .expect("Content-Type", /application\/pdf/)
      .expect(200);

    let storedDeposit = await prisma.legal_deposits.findUnique({
      where: { id: depositId },
    });
    assert.equal(Number(storedDeposit.nominal), 1000);
    assert.equal(Number(storedDeposit.paid_amount), 0);
    assert.equal(Number(storedDeposit.remaining_amount), 1000);

    const paid = await agent
      .post("/api/v1/legal/deposit-transactions")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .field("deposit_id", depositId)
      .field("transaction_date", transactionDate)
      .field("action", "PEMBAYARAN")
      .field("amount", "250")
      .field("notes", "Pembayaran sebagian")
      .attach("files", PDF, {
        filename: "bukti-pembayaran-sebagian.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    const paymentId = paid.body.data?.id;
    assert.equal(typeof paymentId, "string");
    assert.equal(paid.body.data?.source, "MANUAL_ENTRY");
    fixture.track("legalTransaction", paymentId);
    const paymentFile = paid.body.data?.files?.[0];
    assert.ok(paymentFile?.url, "Bukti pembayaran wajib tersedia.");
    storedPaths.add(paymentFile.path);
    await request(app)
      .get(signedPath(paymentFile.url))
      .expect("Content-Type", /application\/pdf/)
      .expect(200);

    storedDeposit = await prisma.legal_deposits.findUnique({
      where: { id: depositId },
    });
    assert.equal(Number(storedDeposit.nominal), 1000);
    assert.equal(Number(storedDeposit.paid_amount), 250);
    assert.equal(Number(storedDeposit.processed_amount), 0);
    assert.equal(Number(storedDeposit.remaining_amount), 750);

    const rejected = await agent
      .post("/api/v1/legal/deposit-transactions")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .send({
        deposit_id: depositId,
        transaction_date: transactionDate,
        action: "REFUND",
        amount: 800,
        notes: "Harus ditolak karena melebihi saldo",
      })
      .expect(422);
    assert.match(rejected.body.message, /tidak boleh melebihi saldo/i);

    const outsiderDeposits = await outsiderAgent
      .get("/api/v1/legal/deposits?page=1&limit=100")
      .set("User-Agent", fixture.userAgent)
      .set(outsiderLogin.authorization)
      .expect(200);
    assert.equal(
      outsiderDeposits.body.data.some((item) => item.id === depositId),
      false,
    );
    await outsiderAgent
      .put(`/api/v1/legal/deposits/${depositId}`)
      .set("User-Agent", fixture.userAgent)
      .set(outsiderLogin.authorization)
      .send({ notes: "Percobaan update di luar scope" })
      .expect(404);
    await outsiderAgent
      .post("/api/v1/legal/deposit-transactions")
      .set("User-Agent", fixture.userAgent)
      .set(outsiderLogin.authorization)
      .send({
        deposit_id: depositId,
        transaction_date: transactionDate,
        action: "PEMBAYARAN",
        amount: 1,
      })
      .expect(404);

    const transactions = await prisma.legal_deposit_transactions.findMany({
      where: { deposit_id: depositId },
      orderBy: { created_at: "asc" },
    });
    assert.equal(transactions.length, 2);
    fixture.track("legalTransaction", transactions[0].id);
    assert.deepEqual(
      transactions.map((item) => item.action),
      ["TITIPAN", "PEMBAYARAN"],
    );
    assert.deepEqual(
      transactions.map((item) => item.source),
      ["OPENING_BALANCE", "MANUAL_ENTRY"],
    );

    const reconciledList = await agent
      .get("/api/v1/legal/deposits?page=1&limit=100&type=ANGSURAN")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .expect(200);
    const reconciledDeposit = reconciledList.body.data.find(
      (item) => item.id === depositId,
    );
    assert.equal(reconciledDeposit.total_deposit_amount, 1000);
    assert.equal(reconciledDeposit.total_payment_amount, 250);
    assert.equal(reconciledDeposit.total_refund_amount, 0);
    assert.equal(reconciledDeposit.balance_amount, 750);
    assert.equal(reconciledDeposit.ledger.transaction_count, 2);
    assert.equal(reconciledDeposit.ledger.reconciliation.status, "MATCHED");

    await prisma.legal_deposits.update({
      where: { id: depositId },
      data: {
        paid_amount: 999,
        processed_amount: 100,
        remaining_amount: 1,
      },
    });

    const mismatchList = await agent
      .get("/api/v1/legal/deposits?page=1&limit=100&type=ANGSURAN")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .expect(200);
    const mismatchedDeposit = mismatchList.body.data.find(
      (item) => item.id === depositId,
    );
    assert.equal(mismatchedDeposit.total_payment_amount, 250);
    assert.equal(mismatchedDeposit.total_refund_amount, 0);
    assert.equal(mismatchedDeposit.balance_amount, 750);
    assert.equal(mismatchedDeposit.ledger.reconciliation.status, "MISMATCH");
    assert.equal(
      mismatchedDeposit.ledger.reconciliation.stored_totals.total_payment_amount,
      999,
    );

    const depositReport = await agent
      .get("/api/v1/legal/reports/third-party-deposit-funds")
      .set("User-Agent", fixture.userAgent)
      .set(login.authorization)
      .expect(200);
    const reportRow = depositReport.body.data?.data?.find(
      (item) => item.type === "ANGSURAN" && item.status === "AKTIF",
    );
    assert.ok(reportRow);
    assert.equal(reportRow.total_deposit_amount, 1000);
    assert.equal(reportRow.total_payment_amount, 250);
    assert.equal(reportRow.total_refund_amount, 0);
    assert.equal(reportRow.balance_amount, 750);
    assert.equal(reportRow.reconciliation_status, "MISMATCH");
    assert.equal(reportRow.mismatched_records, 1);

    const legalAudits = await prisma.legal_activity_logs.findMany({
      where: {
        OR: [
          { entity_id: depositId },
          { deposit_id: depositId },
          { deposit_transaction_id: { in: transactions.map((item) => item.id) } },
        ],
      },
    });
    assert.equal(legalAudits.length, 3);
    assert.ok(legalAudits.every((item) => item.actor_id === admin.id));
    assert.ok(legalAudits.every((item) => item.user_agent === fixture.userAgent));
  },
);
