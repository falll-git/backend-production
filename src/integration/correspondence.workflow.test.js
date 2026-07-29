const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

const { loadEnv } = require("../config/env");

loadEnv();

const { deleteStoredFile } = require("../utils/persuratan-files");
const {
  createActiveUser,
  createIntegrationFixture,
  futureUtcDate,
  loginAgent,
  readAdminCredentials,
} = require("./support/integration-test-helpers");

const PDF_INITIAL = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  "utf8",
);
const PDF_REPLACEMENT = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Version /1.7 >>\nendobj\n%%EOF\n",
  "utf8",
);

function signedPath(fileUrl) {
  const parsed = new URL(fileUrl);
  return `${parsed.pathname}${parsed.search}`;
}

function assertPdfResponse(response) {
  assert.ok(Buffer.isBuffer(response.body));
  assert.equal(response.body.subarray(0, 4).toString("utf8"), "%PDF");
}

test(
  "surat masuk, surat keluar, dan memorandum menjalani transaksi valid dengan file nyata",
  { skip: process.env.RUN_CRITICAL_DB_INTEGRATION !== "true" },
  async (t) => {
    const app = require("../app");
    const prisma = require("../config/prisma");
    const fixture = createIntegrationFixture(prisma, "Correspondence workflow");
    const adminAgent = request.agent(app);
    const managerAgent = request.agent(app);
    const staffAgent = request.agent(app);
    const outsiderAgent = request.agent(app);
    const credentials = readAdminCredentials();
    const storedPaths = new Set();
    const accessTokens = [];

    t.after(async () => {
      for (const { agent, token } of accessTokens) {
        await agent
          .post("/api/v1/auth/logout")
          .set("User-Agent", fixture.userAgent)
          .set("Authorization", `Bearer ${token}`)
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

    const [storage, priority, deliveryMedia, managerRole, staffRole] =
      await Promise.all([
        prisma.storages.findFirst({ where: { is_active: true } }),
        prisma.letter_priorities.findFirst(),
        prisma.mail_delivery_media.findFirst({
          where: { is_active: true, deleted_at: null },
        }),
        prisma.roles.findUnique({ where: { name: "Manager" } }),
        prisma.roles.findUnique({ where: { name: "Staf" } }),
      ]);
    assert.ok(storage, "Lokasi penyimpanan aktif wajib tersedia.");
    assert.ok(priority, "Prioritas surat wajib tersedia.");
    assert.ok(deliveryMedia, "Media pengiriman aktif wajib tersedia.");
    assert.ok(managerRole, "Role Manager wajib tersedia.");
    assert.ok(staffRole, "Role Staf wajib tersedia.");

    const division = await prisma.divisions.create({
      data: { name: fixture.name("Divisi Workflow Surat") },
    });
    fixture.track("division", division.id);
    const outsiderDivision = await prisma.divisions.create({
      data: { name: fixture.name("Divisi Tanpa Akses Surat") },
    });
    fixture.track("division", outsiderDivision.id);
    const suffix = fixture.runId.replace(/-/g, "").slice(0, 10);
    const manager = await createActiveUser(prisma, fixture, {
      username: `it_mail_manager_${suffix}`,
      roleId: managerRole.id,
      divisionId: division.id,
      name: fixture.name("Manajer Disposisi"),
    });
    const staff = await createActiveUser(prisma, fixture, {
      username: `it_mail_staff_${suffix}`,
      roleId: staffRole.id,
      divisionId: division.id,
      name: fixture.name("Staf Penerima"),
    });
    const outsider = await createActiveUser(prisma, fixture, {
      username: `it_mail_outsider_${suffix}`,
      roleId: staffRole.id,
      divisionId: outsiderDivision.id,
      name: fixture.name("Staf Luar Scope Surat"),
    });

    const adminLogin = await loginAgent(
      adminAgent,
      credentials,
      fixture.userAgent,
    );
    accessTokens.push({ agent: adminAgent, token: adminLogin.accessToken });
    const managerLogin = await loginAgent(
      managerAgent,
      { username: manager.username, password: manager.password },
      fixture.userAgent,
    );
    accessTokens.push({ agent: managerAgent, token: managerLogin.accessToken });
    const staffLogin = await loginAgent(
      staffAgent,
      { username: staff.username, password: staff.password },
      fixture.userAgent,
    );
    accessTokens.push({ agent: staffAgent, token: staffLogin.accessToken });
    const outsiderLogin = await loginAgent(
      outsiderAgent,
      { username: outsider.username, password: outsider.password },
      fixture.userAgent,
    );
    accessTokens.push({ agent: outsiderAgent, token: outsiderLogin.accessToken });

    const today = new Date().toISOString();
    const dueDate = futureUtcDate({ days: 7 }).toISOString();

    const incomingCreated = await adminAgent
      .post("/api/v1/incoming-mails/with-disposition")
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .field("letter_prioritie_id", priority.id)
      .field("storage_id", storage.id)
      .field("target_division_ids", JSON.stringify([division.id]))
      .field("regarding", fixture.name("Perihal Surat Masuk"))
      .field("description", "Transaksi valid integration test")
      .field("name", fixture.name("Pengirim Surat"))
      .field("receive_date", today)
      .field("address", "Alamat pengirim integration test")
      .field("mail_number", `IT-SM-${suffix}`)
      .field("note", "Disposisi awal integration test")
      .field("due_date", dueDate)
      .attach("file", PDF_INITIAL, {
        filename: "surat-masuk-awal.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    const incomingId = incomingCreated.body.data?.id;
    assert.equal(typeof incomingId, "string");
    fixture.track("incomingMail", incomingId);
    fixture.track("notificationEntity", incomingId);
    assert.equal(incomingCreated.body.data.status_key, "IN_PROGRESS");
    assert.deepEqual(incomingCreated.body.data.target_division_ids, [division.id]);
    const incomingDispositionId = incomingCreated.body.data.disposition_mails?.[0]?.id;
    assert.equal(typeof incomingDispositionId, "string");
    fixture.track("notificationEntity", incomingDispositionId);
    assert.equal(
      incomingCreated.body.data.disposition_mails[0].receiver_id,
      manager.user.id,
    );
    storedPaths.add(incomingCreated.body.data.file_path);

    await request(app)
      .get(new URL(incomingCreated.body.data.original_file_url).pathname)
      .expect(401);
    const incomingDownload = await request(app)
      .get(signedPath(incomingCreated.body.data.original_file_url))
      .expect("Cache-Control", /private, no-store/)
      .expect("Content-Type", /application\/pdf/)
      .expect(200);
    assertPdfResponse(incomingDownload);

    await managerAgent
      .patch(
        `/api/v1/incoming-mails/${incomingId}/dispositions/${incomingDispositionId}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .send({ status: "IN_PROGRESS" })
      .expect(200);
    const incomingRedisposed = await managerAgent
      .post(`/api/v1/incoming-mails/${incomingId}/redispose`)
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .send({
        receiver_ids: [staff.user.id],
        note: "Diteruskan ke staf integration test",
        due_date: dueDate,
      })
      .expect(201);
    const incomingChildDispositionId = incomingRedisposed.body.data?.[0]?.id;
    assert.equal(typeof incomingChildDispositionId, "string");
    fixture.track("notificationEntity", incomingChildDispositionId);
    await staffAgent
      .patch(
        `/api/v1/incoming-mails/${incomingId}/dispositions/${incomingChildDispositionId}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(staffLogin.authorization)
      .send({ status: "COMPLETED" })
      .expect(200);
    assert.equal(
      (
        await prisma.incoming_mails.findUnique({ where: { id: incomingId } })
      ).status,
      "COMPLETED",
    );

    const outgoingCreated = await adminAgent
      .post("/api/v1/outgoing-mails")
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .field("letter_prioritie_id", priority.id)
      .field("storage_id", storage.id)
      .field("delivery_media", deliveryMedia.code)
      .field("name", fixture.name("Penerima Surat Keluar"))
      .field("send_date", today)
      .field("address", "Alamat penerima integration test")
      .field("mail_number", `IT-SK-${suffix}`)
      .attach("file", PDF_INITIAL, {
        filename: "surat-keluar-awal.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    const outgoingId = outgoingCreated.body.data?.id;
    assert.equal(typeof outgoingId, "string");
    fixture.track("outgoingMail", outgoingId);
    fixture.track("notificationEntity", outgoingId);
    storedPaths.add(outgoingCreated.body.data.file_path);
    assert.equal(outgoingCreated.body.data.status_key, "ACTIVE");

    const outgoingUpdated = await adminAgent
      .put(`/api/v1/outgoing-mails/${outgoingId}`)
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .field("name", fixture.name("Penerima Surat Diperbarui"))
      .field("status", "0")
      .attach("file", PDF_REPLACEMENT, {
        filename: "surat-keluar-baru.pdf",
        contentType: "application/pdf",
      })
      .expect(200);
    storedPaths.add(outgoingUpdated.body.data.file_path);
    assert.equal(outgoingUpdated.body.data.status_key, "INACTIVE");
    assert.equal(outgoingUpdated.body.data.file_name, "surat-keluar-baru.pdf");
    const outgoingDownload = await request(app)
      .get(signedPath(outgoingUpdated.body.data.original_file_url))
      .expect("Content-Type", /application\/pdf/)
      .expect(200);
    assertPdfResponse(outgoingDownload);

    const memorandumCreated = await adminAgent
      .post("/api/v1/memorandums/with-disposition")
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .field("origin_division_id", admin.division_id)
      .field("storage_id", storage.id)
      .field("target_division_ids", JSON.stringify([division.id]))
      .field("memo_number", `IT-MEMO-${suffix}`)
      .field("memo_date", today)
      .field("received_date", today)
      .field("regarding", fixture.name("Perihal Memorandum"))
      .field("description", "Isi memorandum integration test")
      .field("note", "Disposisi memorandum awal")
      .field("due_date", dueDate)
      .attach("file", PDF_INITIAL, {
        filename: "memorandum-awal.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    const memorandumId = memorandumCreated.body.data?.id;
    assert.equal(typeof memorandumId, "string");
    fixture.track("memorandum", memorandumId);
    fixture.track("notificationEntity", memorandumId);
    storedPaths.add(memorandumCreated.body.data.file_path);
    const memorandumDispositionId = memorandumCreated.body.data.dispositions?.[0]?.id;
    assert.equal(typeof memorandumDispositionId, "string");
    fixture.track("notificationEntity", memorandumDispositionId);
    await managerAgent
      .patch(
        `/api/v1/memorandums/${memorandumId}/dispositions/${memorandumDispositionId}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .send({ status: "IN_PROGRESS" })
      .expect(200);
    const memorandumRedisposed = await managerAgent
      .post(`/api/v1/memorandums/${memorandumId}/redispose`)
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .send({
        receiver_ids: [staff.user.id],
        note: "Memorandum diteruskan ke staf",
        due_date: dueDate,
      })
      .expect(201);
    const memorandumChildDispositionId = memorandumRedisposed.body.data?.[0]?.id;
    assert.equal(typeof memorandumChildDispositionId, "string");
    fixture.track("notificationEntity", memorandumChildDispositionId);
    await staffAgent
      .patch(
        `/api/v1/memorandums/${memorandumId}/dispositions/${memorandumChildDispositionId}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(staffLogin.authorization)
      .send({ status: "COMPLETED" })
      .expect(200);
    assert.equal(
      (
        await prisma.memorandums.findUnique({ where: { id: memorandumId } })
      ).status,
      "COMPLETED",
    );

    for (const path of [
      `/api/v1/incoming-mails/${incomingId}`,
      `/api/v1/outgoing-mails/${outgoingId}`,
      `/api/v1/memorandums/${memorandumId}`,
    ]) {
      await outsiderAgent
        .get(path)
        .set("User-Agent", fixture.userAgent)
        .set(outsiderLogin.authorization)
        .expect(404);
    }
    const outsiderReport = await outsiderAgent
      .get("/api/v1/correspondence/report?kind=all&page=1&limit=100")
      .set("User-Agent", fixture.userAgent)
      .set(outsiderLogin.authorization)
      .expect(200);
    assert.equal(
      outsiderReport.body.data.records.incoming_mails.some(
        (item) => item.id === incomingId,
      ),
      false,
    );
    assert.equal(
      outsiderReport.body.data.records.outgoing_mails.some(
        (item) => item.id === outgoingId,
      ),
      false,
    );
    assert.equal(
      outsiderReport.body.data.records.memorandums.some(
        (item) => item.id === memorandumId,
      ),
      false,
    );

    const report = await adminAgent
      .get("/api/v1/correspondence/report?kind=all&page=1&limit=25")
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .expect(200);
    assert.ok(
      report.body.data.records.incoming_mails.some((item) => item.id === incomingId),
    );
    assert.ok(
      report.body.data.records.outgoing_mails.some((item) => item.id === outgoingId),
    );
    assert.ok(
      report.body.data.records.memorandums.some((item) => item.id === memorandumId),
    );

    const printable = await adminAgent
      .get("/api/v1/correspondence/print-documents?kind=all&only_with_file=true")
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .expect(200);
    const printableIds = printable.body.data.items.map((item) => item.id);
    assert.ok(printableIds.includes(incomingId));
    assert.ok(printableIds.includes(outgoingId));
    assert.ok(printableIds.includes(memorandumId));

    await adminAgent
      .delete(`/api/v1/outgoing-mails/${outgoingId}`)
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .expect(200);
    await adminAgent
      .delete(`/api/v1/incoming-mails/${incomingId}`)
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .expect(200);
    await adminAgent
      .delete(`/api/v1/memorandums/${memorandumId}`)
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .expect(200);

    const [storedIncoming, storedOutgoing, storedMemorandum] = await Promise.all([
      prisma.incoming_mails.findUnique({ where: { id: incomingId } }),
      prisma.outgoing_mails.findUnique({ where: { id: outgoingId } }),
      prisma.memorandums.findUnique({ where: { id: memorandumId } }),
    ]);
    assert.ok(storedIncoming.deleted_at);
    assert.ok(storedOutgoing.deleted_at);
    assert.ok(storedMemorandum.deleted_at);
    assert.equal(storedIncoming.deleted_by, admin.id);
    assert.equal(storedOutgoing.deleted_by, admin.id);
    assert.equal(storedMemorandum.deleted_by, admin.id);
  },
);
