const test = require("node:test");
// Legacy suite seeds business states directly; only the owned-run harness is allowed.
require("./support/sj-disposable-guard").rejectLegacyRun();
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const enabled = String(process.env.RUN_CONTROL_REVIEW_ADAPTER_INTEGRATION || "")
  .trim()
  .toLowerCase() === "true";

test("Control review adapter applies once, rejects replay and reports conflict", {
  skip: !enabled,
}, async () => {
  require("dotenv").config();
  const databaseUrl = new URL(process.env.DATABASE_SYSTEM_URL || "");
  const databaseName = databaseUrl.pathname.replace(/^\//, "");
  if (
    !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
    !/(?:^|[_-])(?:local|test|ci)(?:$|[_-])/i.test(databaseName)
  ) {
    throw new Error("Tes adapter hanya boleh memakai database lokal/CI terisolasi.");
  }

  const ids = Object.freeze({
    instance: "20000000-0000-4000-8000-000000000001",
    settings: "20000000-0000-4000-8000-000000000002",
    role: "20000000-0000-4000-8000-000000000003",
    division: "20000000-0000-4000-8000-000000000004",
    user: "20000000-0000-4000-8000-000000000005",
    profile: "20000000-0000-4000-8000-000000000006",
    version: "20000000-0000-4000-8000-000000000007",
    command: "20000000-0000-4000-8000-000000000008",
    conflictCommand: "20000000-0000-4000-8000-000000000009",
  });
  const controlKeys = crypto.generateKeyPairSync("ed25519");
  const bankKeys = crypto.generateKeyPairSync("ed25519");
  Object.assign(process.env, {
    SJ_CONTROL_REVIEW_AUTHORITY: "central",
    SJ_CONTROL_INSTANCE_ID: ids.instance,
    SJ_CONTROL_KEY_ID: "control-local-integration-v1",
    SJ_CONTROL_PUBLIC_KEY: controlKeys.publicKey.export({
      type: "spki",
      format: "pem",
    }),
    SJ_CONTROL_ACK_KEY_ID: "bank-local-integration-v1",
    SJ_CONTROL_ACK_PRIVATE_KEY: bankKeys.privateKey.export({
      type: "pkcs8",
      format: "pem",
    }),
    SJ_CONTROL_AUDIENCE: "ruwang-bank:local-integration",
    SJ_CONTROL_MAX_CLOCK_SKEW_SECONDS: "300",
    SJ_CONTROL_NONCE_TTL_SECONDS: "600",
  });

  const prisma = require("../config/prisma-system");
  const contract = require("../modules/seputar-jaminan/controlReview.contract");
  const service = require("../modules/seputar-jaminan/controlReview.service");
  const checksum = "a".repeat(64);

  async function cleanup() {
    await prisma.sj_control_request_nonces.deleteMany({
      where: { instance_id: ids.instance },
    });
    await prisma.sj_control_review_commands.deleteMany({
      where: { instance_id: ids.instance },
    });
    await prisma.sj_public_profiles.updateMany({
      where: { id: ids.profile },
      data: { current_version_id: null },
    });
    await prisma.sj_public_profile_versions.deleteMany({
      where: { profile_id: ids.profile },
    });
    await prisma.sj_public_profiles.deleteMany({ where: { id: ids.profile } });
    await prisma.sj_integration_settings.deleteMany({
      where: { id: ids.settings },
    });
    await prisma.users.deleteMany({ where: { id: ids.user } });
    await prisma.roles.deleteMany({ where: { id: ids.role } });
    await prisma.divisions.deleteMany({ where: { id: ids.division } });
  }

  function command(commandId, expectedVersion = 1) {
    const now = new Date();
    return {
      contract_version: 1,
      command_id: commandId,
      instance_id: ids.instance,
      actor_subject:
        "ruwang-control:20000000-0000-4000-8000-000000000010",
      audience: process.env.SJ_CONTROL_AUDIENCE,
      resource: { kind: "profile", id: ids.profile },
      decision: "request_revision",
      contributor_subjects: [`ruwang-bank:${ids.user}`],
      reason: "Lengkapi keterangan profil.",
      expected_version: expectedVersion,
      expected_checksum: checksum,
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 60_000).toISOString(),
    };
  }

  function signedRequest(payload, nonce = crypto.randomUUID()) {
    const timestamp = new Date().toISOString();
    const digest = contract.payloadDigest(payload);
    const signature = contract.signTransport(
      contract.signingMessage({
        method: "POST",
        path: service.COMMAND_PATH,
        timestamp,
        nonce,
        contentSha256: digest,
      }),
      controlKeys.privateKey,
    );
    const headers = {
      [contract.headerNames.instanceId]: ids.instance,
      [contract.headerNames.keyId]: process.env.SJ_CONTROL_KEY_ID,
      [contract.headerNames.timestamp]: timestamp,
      [contract.headerNames.nonce]: nonce,
      [contract.headerNames.contentSha256]: digest,
      [contract.headerNames.signature]: signature,
    };
    return { body: payload, get: (name) => headers[name] };
  }

  function verifySignedAck(result) {
    const ack = JSON.parse(result.body);
    const digest = contract.payloadDigest(ack);
    const message = contract.signingMessage({
      method: "POST",
      path: service.COMMAND_PATH,
      timestamp: result.headers[contract.headerNames.acknowledgmentTimestamp],
      nonce: result.headers[contract.headerNames.acknowledgmentNonce],
      contentSha256: digest,
    });
    assert.equal(
      contract.verifyTransport(
        message,
        result.headers[contract.headerNames.acknowledgmentSignature],
        bankKeys.publicKey,
      ),
      true,
    );
    return ack;
  }

  await prisma.$connect();
  await cleanup();
  try {
    await prisma.roles.create({
      data: { id: ids.role, name: "Control adapter test role" },
    });
    await prisma.divisions.create({
      data: { id: ids.division, name: "Control adapter test division" },
    });
    await prisma.users.create({
      data: {
        id: ids.user,
        name: "Control adapter contributor",
        username: "control-adapter-contributor",
        email: "control-adapter@example.test",
        password: "not-used-by-adapter",
        role_id: ids.role,
        division_id: ids.division,
        onboarding_status: "ACTIVE",
      },
    });
    await prisma.sj_integration_settings.create({
      data: {
        id: ids.settings,
        institution_id: "20000000-0000-4000-8000-000000000011",
        installation_id: ids.instance,
        key_id: "sj-local-test",
        central_base_url: "http://127.0.0.1:4010/api/v1",
        connection_state: "ACTIVE",
        module_visible: true,
        draft_enabled: true,
        review_enabled: true,
        sync_enabled: true,
        publish_enabled: true,
        review_authority: "central",
      },
    });
    await prisma.sj_public_profiles.create({
      data: {
        id: ids.profile,
        display_name: "BPRS Adapter Test",
        public_slug: "bprs-adapter-test",
        city_regency: "Bogor",
        province: "Jawa Barat",
        short_description: "Fixture lokal terisolasi.",
        state: "DRAFT",
        lock_version: 1,
        created_by: ids.user,
        updated_by: ids.user,
      },
    });
    await prisma.sj_public_profile_versions.create({
      data: {
        id: ids.version,
        profile_id: ids.profile,
        version_number: 1,
        payload_json: { public_name: "BPRS Adapter Test" },
        payload_checksum: checksum,
        created_by: ids.user,
      },
    });
    await prisma.sj_public_profile_versions.update({
      where: { id: ids.version },
      data: { state: "IN_REVIEW", submitted_at: new Date() },
    });
    await prisma.sj_public_profiles.update({
      where: { id: ids.profile },
      data: { state: "IN_REVIEW" },
    });

    const payload = command(ids.command);
    const first = verifySignedAck(
      await service.handleCommand(signedRequest(payload)),
    );
    assert.equal(first.status, "APPLIED");
    assert.equal(first.result_code, "DECISION_APPLIED");

    const retried = verifySignedAck(
      await service.handleCommand(signedRequest(payload)),
    );
    assert.equal(retried.acknowledgment_id, first.acknowledgment_id);
    const profile = await prisma.sj_public_profiles.findUnique({
      where: { id: ids.profile },
    });
    assert.equal(profile.state, "REVISION_REQUIRED");
    assert.equal(profile.lock_version, 2);

    const replayNonce = crypto.randomUUID();
    const replayRequest = signedRequest(payload, replayNonce);
    verifySignedAck(await service.handleCommand(replayRequest));
    await assert.rejects(
      () => service.handleCommand(replayRequest),
      /Nonce adapter sudah pernah digunakan/,
    );

    const conflict = command(ids.conflictCommand, 1);
    const rejected = verifySignedAck(
      await service.handleCommand(signedRequest(conflict)),
    );
    assert.equal(rejected.status, "REJECTED");
    assert.equal(rejected.result_code, "VERSION_CONFLICT");

    const commandRows = await prisma.sj_control_review_commands.count({
      where: { instance_id: ids.instance },
    });
    assert.equal(commandRows, 2);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
});
