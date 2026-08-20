const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

const { loadEnv } = require("../config/env");

loadEnv();

const { deleteStoredFile } = require("../utils/persuratan-files");
const { withRlsUserContext } = require("../config/database-rls");
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
    const prisma = require("../config/prisma-system");
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
    accessTokens.push({
      agent: outsiderAgent,
      token: outsiderLogin.accessToken,
    });

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
    assert.deepEqual(incomingCreated.body.data.target_division_ids, [
      division.id,
    ]);
    const incomingDispositionId =
      incomingCreated.body.data.disposition_mails?.[0]?.id;
    assert.equal(typeof incomingDispositionId, "string");
    fixture.track("notificationEntity", incomingDispositionId);
    assert.equal(
      incomingCreated.body.data.disposition_mails[0].receiver_id,
      manager.user.id,
    );
    assert.equal(
      incomingCreated.body.data.disposition_mails[0].can_start,
      true,
    );
    assert.equal(
      incomingCreated.body.data.disposition_mails[0].can_complete,
      false,
    );
    assert.equal(
      incomingCreated.body.data.disposition_mails[0].can_redispose,
      false,
    );
    assert.deepEqual(incomingCreated.body.data.initial_recipient_names, [
      manager.user.name,
    ]);
    assert.deepEqual(incomingCreated.body.data.current_holder_names, [
      manager.user.name,
    ]);
    assert.equal(
      (
        await prisma.notifications.findFirst({
          where: {
            recipient_id: manager.user.id,
            link_url: `/dashboard/manajemen-surat/laporan?kind=surat-masuk&id=${incomingId}`,
          },
        })
      )?.link_url,
      `/dashboard/manajemen-surat/laporan?kind=surat-masuk&id=${incomingId}`,
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

    const incomingDirectComplete = await managerAgent
      .patch(`/api/v1/incoming-mails/${incomingId}/complete`)
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .expect(400);
    assert.match(
      incomingDirectComplete.body.message,
      /Mulai proses terlebih dahulu/,
    );

    const incomingPrematureDispositionComplete = await managerAgent
      .patch(
        `/api/v1/incoming-mails/${incomingId}/dispositions/${incomingDispositionId}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .send({ status: "COMPLETED" })
      .expect(400);
    assert.match(
      incomingPrematureDispositionComplete.body.message,
      /Mulai proses terlebih dahulu/,
    );

    const incomingPrematureRedispose = await managerAgent
      .post(`/api/v1/incoming-mails/${incomingId}/redispose`)
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .send({
        receiver_ids: [staff.user.id],
        note: "Belum boleh diteruskan",
      })
      .expect(400);
    assert.match(
      incomingPrematureRedispose.body.message,
      /Mulai proses terlebih dahulu/,
    );

    const incomingStarted = await managerAgent
      .patch(
        `/api/v1/incoming-mails/${incomingId}/dispositions/${incomingDispositionId}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .send({ status: "IN_PROGRESS" })
      .expect(200);
    const incomingStartedDisposition =
      incomingStarted.body.data.disposition_mails.find(
        (item) => item.id === incomingDispositionId,
      );
    assert.equal(incomingStartedDisposition.status_label, "Dalam Proses");
    assert.equal(incomingStartedDisposition.can_start, false);
    assert.equal(incomingStartedDisposition.can_complete, true);
    assert.equal(incomingStartedDisposition.can_redispose, true);
    const incomingRedisposed = await managerAgent
      .post(`/api/v1/incoming-mails/${incomingId}/redispose`)
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .send({
        receiver_ids: [staff.user.id],
        note: "Diteruskan ke staf integration test",
        due_date: dueDate,
      })
      .expect((response) => {
        assert.equal(
          response.statusCode,
          201,
          `Redisposisi surat masuk gagal: ${JSON.stringify(response.body)}`,
        );
      });
    const incomingChildDispositionId = incomingRedisposed.body.data?.[0]?.id;
    assert.equal(typeof incomingChildDispositionId, "string");
    fixture.track("notificationEntity", incomingChildDispositionId);
    assert.equal(incomingRedisposed.body.data[0].can_start, true);
    assert.equal(incomingRedisposed.body.data[0].can_complete, false);
    assert.equal(incomingRedisposed.body.data[0].can_redispose, false);
    assert.equal(
      (
        await prisma.notifications.findFirst({
          where: {
            recipient_id: staff.user.id,
            link_url: `/dashboard/manajemen-surat/laporan?kind=surat-masuk&id=${incomingId}`,
          },
        })
      )?.link_url,
      `/dashboard/manajemen-surat/laporan?kind=surat-masuk&id=${incomingId}`,
    );
    const incomingChildPrematureComplete = await staffAgent
      .patch(
        `/api/v1/incoming-mails/${incomingId}/dispositions/${incomingChildDispositionId}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(staffLogin.authorization)
      .send({ status: "COMPLETED" })
      .expect(400);
    assert.match(
      incomingChildPrematureComplete.body.message,
      /Mulai proses terlebih dahulu/,
    );
    await staffAgent
      .patch(
        `/api/v1/incoming-mails/${incomingId}/dispositions/${incomingChildDispositionId}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(staffLogin.authorization)
      .send({ status: "IN_PROGRESS" })
      .expect(200);
    await staffAgent
      .patch(
        `/api/v1/incoming-mails/${incomingId}/dispositions/${incomingChildDispositionId}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(staffLogin.authorization)
      .send({ status: "COMPLETED" })
      .expect(200);
    assert.equal(
      (await prisma.incoming_mails.findUnique({ where: { id: incomingId } }))
        .status,
      "COMPLETED",
    );
    const [managerReadEvidence] = await withRlsUserContext(
      manager.user.id,
      (tx) => tx.$queryRaw`
        SELECT
          public.ruwang_arsip_can_read_incoming_mail(${incomingId}) AS can_read,
          public.ruwang_arsip_has_menu_permission(
            ARRAY['/dashboard/manajemen-surat/kelola-surat/input-surat-masuk']::text[],
            'read'
          ) AS has_read_permission
      `,
    );
    assert.equal(
      managerReadEvidence?.can_read,
      true,
      `Penerima sebelumnya harus tetap dapat membaca riwayat surat: ${JSON.stringify(managerReadEvidence)}`,
    );
    const incomingCompletedForManager = await managerAgent
      .get(`/api/v1/incoming-mails/${incomingId}`)
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .expect(200);
    assert.deepEqual(
      incomingCompletedForManager.body.data.initial_recipient_names,
      [manager.user.name],
    );
    assert.deepEqual(
      incomingCompletedForManager.body.data.current_holder_names,
      [],
    );
    assert.equal(
      incomingCompletedForManager.body.data.active_dispositions_count,
      0,
    );
    assert.equal(
      incomingCompletedForManager.body.data.disposition_mails.length,
      2,
    );
    await staffAgent
      .get(`/api/v1/incoming-mails/${incomingId}`)
      .set("User-Agent", fixture.userAgent)
      .set(staffLogin.authorization)
      .expect(200);

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
    const memorandumDispositionId =
      memorandumCreated.body.data.dispositions?.[0]?.id;
    assert.equal(typeof memorandumDispositionId, "string");
    fixture.track("notificationEntity", memorandumDispositionId);
    assert.equal(memorandumCreated.body.data.dispositions[0].can_start, true);
    assert.equal(
      memorandumCreated.body.data.dispositions[0].can_complete,
      false,
    );
    assert.equal(
      memorandumCreated.body.data.dispositions[0].can_redispose,
      false,
    );
    assert.deepEqual(memorandumCreated.body.data.initial_recipient_names, [
      manager.user.name,
    ]);
    assert.equal(
      (
        await prisma.notifications.findFirst({
          where: {
            recipient_id: manager.user.id,
            link_url: `/dashboard/manajemen-surat/laporan?kind=memorandum&id=${memorandumId}`,
          },
        })
      )?.link_url,
      `/dashboard/manajemen-surat/laporan?kind=memorandum&id=${memorandumId}`,
    );

    const memorandumDirectComplete = await managerAgent
      .patch(`/api/v1/memorandums/${memorandumId}/complete`)
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .expect(400);
    assert.match(
      memorandumDirectComplete.body.message,
      /Mulai proses terlebih dahulu/,
    );

    const memorandumPrematureComplete = await managerAgent
      .patch(
        `/api/v1/memorandums/${memorandumId}/dispositions/${memorandumDispositionId}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .send({ status: "COMPLETED" })
      .expect(400);
    assert.match(
      memorandumPrematureComplete.body.message,
      /Mulai proses terlebih dahulu/,
    );

    const memorandumPrematureRedispose = await managerAgent
      .post(`/api/v1/memorandums/${memorandumId}/redispose`)
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .send({ receiver_ids: [staff.user.id], note: "Belum boleh diteruskan" })
      .expect(400);
    assert.match(
      memorandumPrematureRedispose.body.message,
      /Mulai proses terlebih dahulu/,
    );

    const memorandumStarted = await managerAgent
      .patch(
        `/api/v1/memorandums/${memorandumId}/dispositions/${memorandumDispositionId}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .send({ status: "IN_PROGRESS" })
      .expect(200);
    const memorandumStartedDisposition =
      memorandumStarted.body.data.dispositions.find(
        (item) => item.id === memorandumDispositionId,
      );
    assert.equal(memorandumStartedDisposition.status_label, "Dalam Proses");
    assert.equal(memorandumStartedDisposition.can_start, false);
    assert.equal(memorandumStartedDisposition.can_complete, true);
    assert.equal(memorandumStartedDisposition.can_redispose, true);
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
    const memorandumChildDispositionId =
      memorandumRedisposed.body.data?.[0]?.id;
    assert.equal(typeof memorandumChildDispositionId, "string");
    fixture.track("notificationEntity", memorandumChildDispositionId);
    assert.equal(memorandumRedisposed.body.data[0].can_start, true);
    assert.equal(memorandumRedisposed.body.data[0].can_complete, false);
    assert.equal(memorandumRedisposed.body.data[0].can_redispose, false);
    assert.equal(
      (
        await prisma.notifications.findFirst({
          where: {
            recipient_id: staff.user.id,
            link_url: `/dashboard/manajemen-surat/laporan?kind=memorandum&id=${memorandumId}`,
          },
        })
      )?.link_url,
      `/dashboard/manajemen-surat/laporan?kind=memorandum&id=${memorandumId}`,
    );
    const memorandumChildPrematureComplete = await staffAgent
      .patch(
        `/api/v1/memorandums/${memorandumId}/dispositions/${memorandumChildDispositionId}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(staffLogin.authorization)
      .send({ status: "COMPLETED" })
      .expect(400);
    assert.match(
      memorandumChildPrematureComplete.body.message,
      /Mulai proses terlebih dahulu/,
    );
    await staffAgent
      .patch(
        `/api/v1/memorandums/${memorandumId}/dispositions/${memorandumChildDispositionId}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(staffLogin.authorization)
      .send({ status: "IN_PROGRESS" })
      .expect(200);
    await staffAgent
      .patch(
        `/api/v1/memorandums/${memorandumId}/dispositions/${memorandumChildDispositionId}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(staffLogin.authorization)
      .send({ status: "COMPLETED" })
      .expect(200);
    assert.equal(
      (await prisma.memorandums.findUnique({ where: { id: memorandumId } }))
        .status,
      "COMPLETED",
    );
    const memorandumCompletedForManager = await managerAgent
      .get(`/api/v1/memorandums/${memorandumId}`)
      .set("User-Agent", fixture.userAgent)
      .set(managerLogin.authorization)
      .expect(200);
    assert.deepEqual(
      memorandumCompletedForManager.body.data.initial_recipient_names,
      [manager.user.name],
    );
    assert.deepEqual(
      memorandumCompletedForManager.body.data.current_holder_names,
      [],
    );
    assert.equal(
      memorandumCompletedForManager.body.data.active_dispositions_count,
      0,
    );
    assert.equal(
      memorandumCompletedForManager.body.data.dispositions.length,
      2,
    );
    await staffAgent
      .get(`/api/v1/memorandums/${memorandumId}`)
      .set("User-Agent", fixture.userAgent)
      .set(staffLogin.authorization)
      .expect(200);

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
      report.body.data.records.incoming_mails.some(
        (item) => item.id === incomingId,
      ),
    );
    assert.ok(
      report.body.data.records.outgoing_mails.some(
        (item) => item.id === outgoingId,
      ),
    );
    assert.ok(
      report.body.data.records.memorandums.some(
        (item) => item.id === memorandumId,
      ),
    );

    const printable = await adminAgent
      .get(
        "/api/v1/correspondence/print-documents?kind=all&only_with_file=true",
      )
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

    const [storedIncoming, storedOutgoing, storedMemorandum] =
      await Promise.all([
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

test(
  "memorandum dengan dua penerima awal memproses setiap jalur secara independen sampai seluruhnya selesai",
  { skip: process.env.RUN_CRITICAL_DB_INTEGRATION !== "true" },
  async (t) => {
    const app = require("../app");
    const prisma = require("../config/prisma-system");
    const fixture = createIntegrationFixture(
      prisma,
      "Memorandum multi recipient workflow",
    );
    const adminAgent = request.agent(app);
    const firstManagerAgent = request.agent(app);
    const secondManagerAgent = request.agent(app);
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
    assert.ok(admin?.division_id, "Admin integration test dengan divisi wajib tersedia.");

    const [storage, managerRole] = await Promise.all([
      prisma.storages.findFirst({ where: { is_active: true } }),
      prisma.roles.findUnique({ where: { name: "Manager" } }),
    ]);
    assert.ok(storage, "Lokasi penyimpanan aktif wajib tersedia.");
    assert.ok(managerRole, "Role Manager wajib tersedia.");

    const [firstDivision, secondDivision] = await Promise.all([
      prisma.divisions.create({
        data: { name: fixture.name("Divisi Penerima Pertama") },
      }),
      prisma.divisions.create({
        data: { name: fixture.name("Divisi Penerima Kedua") },
      }),
    ]);
    fixture.track("division", firstDivision.id);
    fixture.track("division", secondDivision.id);

    const suffix = fixture.runId.replace(/-/g, "").slice(0, 10);
    const [firstManager, secondManager] = await Promise.all([
      createActiveUser(prisma, fixture, {
        username: `it_memo_first_${suffix}`,
        roleId: managerRole.id,
        divisionId: firstDivision.id,
        name: fixture.name("Manajer Penerima Pertama"),
      }),
      createActiveUser(prisma, fixture, {
        username: `it_memo_second_${suffix}`,
        roleId: managerRole.id,
        divisionId: secondDivision.id,
        name: fixture.name("Manajer Penerima Kedua"),
      }),
    ]);

    const adminLogin = await loginAgent(
      adminAgent,
      credentials,
      fixture.userAgent,
    );
    accessTokens.push({ agent: adminAgent, token: adminLogin.accessToken });
    const firstManagerLogin = await loginAgent(
      firstManagerAgent,
      { username: firstManager.username, password: firstManager.password },
      fixture.userAgent,
    );
    accessTokens.push({
      agent: firstManagerAgent,
      token: firstManagerLogin.accessToken,
    });
    const secondManagerLogin = await loginAgent(
      secondManagerAgent,
      { username: secondManager.username, password: secondManager.password },
      fixture.userAgent,
    );
    accessTokens.push({
      agent: secondManagerAgent,
      token: secondManagerLogin.accessToken,
    });

    const now = new Date().toISOString();
    const created = await adminAgent
      .post("/api/v1/memorandums/with-disposition")
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .field("origin_division_id", admin.division_id)
      .field("storage_id", storage.id)
      .field(
        "target_division_ids",
        JSON.stringify([firstDivision.id, secondDivision.id]),
      )
      .field("memo_number", `IT-MULTI-MEMO-${suffix}`)
      .field("memo_date", now)
      .field("received_date", now)
      .field("regarding", fixture.name("Memorandum Dua Penerima Awal"))
      .field("description", "Setiap penerima memproses jalurnya sendiri.")
      .field("note", "Disposisi awal paralel integration test")
      .field("due_date", futureUtcDate({ days: 7 }).toISOString())
      .attach("file", PDF_INITIAL, {
        filename: "memorandum-dua-penerima.pdf",
        contentType: "application/pdf",
      })
      .expect(201);

    const memorandumId = created.body.data?.id;
    assert.equal(typeof memorandumId, "string");
    fixture.track("memorandum", memorandumId);
    fixture.track("notificationEntity", memorandumId);
    storedPaths.add(created.body.data.file_path);

    const dispositions = created.body.data.dispositions;
    assert.equal(dispositions.length, 2);
    assert.equal(created.body.data.status_key, "IN_PROGRESS");
    assert.deepEqual(
      new Set(created.body.data.initial_recipient_names),
      new Set([firstManager.user.name, secondManager.user.name]),
    );
    assert.deepEqual(
      new Set(created.body.data.current_holder_names),
      new Set([firstManager.user.name, secondManager.user.name]),
    );
    assert.ok(dispositions.every((item) => item.status_key === "NEW"));
    assert.ok(dispositions.every((item) => item.can_start === true));
    assert.ok(dispositions.every((item) => item.can_complete === false));

    const firstDisposition = dispositions.find(
      (item) => item.receiver_id === firstManager.user.id,
    );
    const secondDisposition = dispositions.find(
      (item) => item.receiver_id === secondManager.user.id,
    );
    assert.ok(firstDisposition);
    assert.ok(secondDisposition);
    fixture.track("notificationEntity", firstDisposition.id);
    fixture.track("notificationEntity", secondDisposition.id);

    const notifications = await prisma.notifications.findMany({
      where: {
        recipient_id: {
          in: [firstManager.user.id, secondManager.user.id],
        },
        link_url: `/dashboard/manajemen-surat/laporan?kind=memorandum&id=${memorandumId}`,
      },
      select: { recipient_id: true },
    });
    assert.deepEqual(
      new Set(notifications.map((item) => item.recipient_id)),
      new Set([firstManager.user.id, secondManager.user.id]),
    );

    await firstManagerAgent
      .patch(
        `/api/v1/memorandums/${memorandumId}/dispositions/${firstDisposition.id}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(firstManagerLogin.authorization)
      .send({ status: "IN_PROGRESS" })
      .expect(200);
    const firstCompleted = await firstManagerAgent
      .patch(
        `/api/v1/memorandums/${memorandumId}/dispositions/${firstDisposition.id}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(firstManagerLogin.authorization)
      .send({ status: "COMPLETED" })
      .expect((response) => {
        assert.equal(
          response.statusCode,
          200,
          `Penyelesaian disposisi memorandum gagal: ${JSON.stringify(response.body)}`,
        );
      });

    assert.equal(firstCompleted.body.data.status_key, "IN_PROGRESS");
    assert.deepEqual(firstCompleted.body.data.current_holder_names, [
      secondManager.user.name,
    ]);
    assert.equal(firstCompleted.body.data.active_dispositions_count, 1);
    assert.equal(
      firstCompleted.body.data.dispositions.find(
        (item) => item.id === firstDisposition.id,
      ).status_key,
      "COMPLETED",
    );
    assert.equal(
      firstCompleted.body.data.dispositions.find(
        (item) => item.id === secondDisposition.id,
      ).status_key,
      "NEW",
    );

    await firstManagerAgent
      .patch(
        `/api/v1/memorandums/${memorandumId}/dispositions/${secondDisposition.id}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(firstManagerLogin.authorization)
      .send({ status: "IN_PROGRESS" })
      .expect(403);

    const secondPrematureComplete = await secondManagerAgent
      .patch(
        `/api/v1/memorandums/${memorandumId}/dispositions/${secondDisposition.id}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(secondManagerLogin.authorization)
      .send({ status: "COMPLETED" })
      .expect(400);
    assert.match(
      secondPrematureComplete.body.message,
      /Mulai proses terlebih dahulu/,
    );

    await secondManagerAgent
      .patch(
        `/api/v1/memorandums/${memorandumId}/dispositions/${secondDisposition.id}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(secondManagerLogin.authorization)
      .send({ status: "IN_PROGRESS" })
      .expect(200);
    const allCompleted = await secondManagerAgent
      .patch(
        `/api/v1/memorandums/${memorandumId}/dispositions/${secondDisposition.id}/status`,
      )
      .set("User-Agent", fixture.userAgent)
      .set(secondManagerLogin.authorization)
      .send({ status: "COMPLETED" })
      .expect(200);

    assert.equal(allCompleted.body.data.status_key, "COMPLETED");
    assert.deepEqual(allCompleted.body.data.current_holder_names, []);
    assert.equal(allCompleted.body.data.active_dispositions_count, 0);
    assert.equal(allCompleted.body.data.dispositions.length, 2);
    assert.ok(
      allCompleted.body.data.dispositions.every(
        (item) => item.status_key === "COMPLETED",
      ),
    );

    await adminAgent
      .delete(`/api/v1/memorandums/${memorandumId}`)
      .set("User-Agent", fixture.userAgent)
      .set(adminLogin.authorization)
      .expect(200);
  },
);
