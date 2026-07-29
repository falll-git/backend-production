const crypto = require("node:crypto");

const { hashPassword } = require("../../utils/bcrypt");

function assertSafeIntegrationDatabase(label = "Integration test", env = process.env) {
  let databaseUrl;
  try {
    databaseUrl = new URL(String(env.DATABASE_URL || ""));
  } catch {
    throw new Error(`${label} ditolak: DATABASE_URL tidak valid.`);
  }

  const hostname = databaseUrl.hostname.toLowerCase();
  const databaseName = decodeURIComponent(
    databaseUrl.pathname.replace(/^\//, ""),
  );
  const loopback =
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.startsWith("127.");
  const githubService =
    hostname === "postgres" &&
    String(env.CI || "").trim().toLowerCase() === "true" &&
    String(env.GITHUB_ACTIONS || "").trim().toLowerCase() === "true";
  const explicitlyTestDatabase = /(?:^|[_-])(?:ci|test|local)(?:$|[_-])/i.test(
    databaseName,
  );

  if (!loopback && !(githubService && explicitlyTestDatabase)) {
    throw new Error(
      `${label} ditolak: DATABASE_URL harus loopback atau service PostgreSQL GitHub Actions dengan database ci/test/local.`,
    );
  }

  return { databaseName, hostname };
}

function readAdminCredentials(env = process.env) {
  const username = String(
    env.API_TEST_ADMIN_USERNAME || env.SEED_ADMIN_USERNAME || "",
  ).trim();
  const password = String(
    env.API_TEST_ADMIN_PASSWORD || env.SEED_ADMIN_PASSWORD || "",
  );

  if (!username || !password) {
    throw new Error(
      "API_TEST_ADMIN_USERNAME/API_TEST_ADMIN_PASSWORD atau kredensial seed admin wajib diisi.",
    );
  }

  return { password, username };
}

function buildAuthorization(accessToken) {
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Access token integration test tidak tersedia.");
  }
  return { Authorization: `Bearer ${accessToken}` };
}

async function loginAgent(agent, credentials, userAgent) {
  const response = await agent
    .post("/api/v1/auth/login")
    .set("User-Agent", userAgent)
    .send({
      username: credentials.username,
      password: credentials.password,
      remember: false,
    })
    .expect(200);
  const accessToken = response.body.data?.token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Login integration test tidak mengembalikan access token.");
  }

  return {
    accessToken,
    authorization: buildAuthorization(accessToken),
    response,
  };
}

function futureUtcDate({ days = 0, months = 0, years = 0 } = {}) {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear() + years,
      now.getUTCMonth() + months,
      now.getUTCDate() + days,
    ),
  );
}

async function waitFor(check, { intervalMs = 25, timeoutMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;

  while (Date.now() <= deadline) {
    lastValue = await check();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return lastValue;
}

function createIntegrationFixture(prisma, label, options = {}) {
  assertSafeIntegrationDatabase(label);
  const runId = options.runId || crypto.randomUUID();
  const safeLabel = String(label || "workflow")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const userAgent =
    options.userAgent || `RuwangArsipIntegration/${safeLabel}/${runId}`;
  const ids = new Map();

  function track(kind, id) {
    if (!id) return id;
    if (!ids.has(kind)) ids.set(kind, new Set());
    ids.get(kind).add(id);
    return id;
  }

  function values(kind) {
    return Array.from(ids.get(kind) || []);
  }

  async function cleanup() {
    assertSafeIntegrationDatabase(`${label} cleanup`);
    await new Promise((resolve) => setTimeout(resolve, 75));

    const notificationEntityIds = values("notificationEntity");
    if (notificationEntityIds.length > 0) {
      await prisma.notifications.deleteMany({
        where: { entity_id: { in: notificationEntityIds } },
      });
    }

    const trackedEntityIds = Array.from(
      new Set(
        Array.from(ids.values()).flatMap((trackedIds) =>
          Array.from(trackedIds),
        ),
      ),
    );
    const activityEntityIds = [
      ...values("legalNotary"),
      ...values("legalInsurance"),
      ...values("legalKjpp"),
      ...values("legalClaim"),
      ...values("legalDeposit"),
      ...values("legalTransaction"),
      ...values("debtorDocument"),
      ...values("marketingActivity"),
      ...values("warningLetter"),
      ...values("importJob"),
      ...values("idebUpload"),
      ...values("collateral"),
      ...values("contract"),
      ...values("debtor"),
    ];
    await Promise.all([
      prisma.system_activity_logs.deleteMany({
        where: {
          OR: [
            { user_agent: userAgent },
            ...(trackedEntityIds.length > 0
              ? [{ entity_id: { in: trackedEntityIds } }]
              : []),
          ],
        },
      }),
      prisma.debtor_activity_logs.deleteMany({
        where: {
          OR: [
            { user_agent: userAgent },
            ...(activityEntityIds.length > 0
              ? [{ entity_id: { in: activityEntityIds } }]
              : []),
          ],
        },
      }),
      prisma.legal_activity_logs.deleteMany({
        where: {
          OR: [
            { user_agent: userAgent },
            ...(activityEntityIds.length > 0
              ? [{ entity_id: { in: activityEntityIds } }]
              : []),
          ],
        },
      }),
      prisma.refresh_tokens.deleteMany({ where: { user_agent: userAgent } }),
    ]);

    const legalDepositIds = values("legalDeposit");
    if (legalDepositIds.length > 0) {
      await prisma.legal_deposits.deleteMany({
        where: { id: { in: legalDepositIds } },
      });
    }

    const legalClaimIds = values("legalClaim");
    if (legalClaimIds.length > 0) {
      await prisma.legal_claims.deleteMany({
        where: { id: { in: legalClaimIds } },
      });
    }

    const legalNotaryIds = values("legalNotary");
    if (legalNotaryIds.length > 0) {
      await prisma.legal_notary_progress.deleteMany({
        where: { id: { in: legalNotaryIds } },
      });
    }

    const legalKjppIds = values("legalKjpp");
    if (legalKjppIds.length > 0) {
      await prisma.legal_kjpp_progress.deleteMany({
        where: { id: { in: legalKjppIds } },
      });
    }

    const legalInsuranceIds = values("legalInsurance");
    if (legalInsuranceIds.length > 0) {
      await prisma.legal_insurance_progress.deleteMany({
        where: { id: { in: legalInsuranceIds } },
      });
    }

    const documentIds = values("digitalDocument");
    if (documentIds.length > 0) {
      await prisma.digital_documents.deleteMany({
        where: { id: { in: documentIds } },
      });
    }

    const importJobIds = values("importJob");
    const idebUploadIds = values("idebUpload");
    if (idebUploadIds.length > 0 || importJobIds.length > 0) {
      await prisma.debtor_ideb_uploads.deleteMany({
        where: {
          OR: [
            ...(idebUploadIds.length > 0
              ? [{ id: { in: idebUploadIds } }]
              : []),
            ...(importJobIds.length > 0
              ? [{ import_job_id: { in: importJobIds } }]
              : []),
          ],
        },
      });
    }

    const externalRecordIds = values("externalRecord");
    if (externalRecordIds.length > 0 || importJobIds.length > 0) {
      await prisma.debtor_external_records.deleteMany({
        where: {
          OR: [
            ...(externalRecordIds.length > 0
              ? [{ id: { in: externalRecordIds } }]
              : []),
            ...(importJobIds.length > 0
              ? [{ import_job_id: { in: importJobIds } }]
              : []),
          ],
        },
      });
    }

    if (importJobIds.length > 0) {
      await prisma.debtor_import_jobs.deleteMany({
        where: { id: { in: importJobIds } },
      });
    }

    const warningLetterIds = values("warningLetter");
    if (warningLetterIds.length > 0) {
      await prisma.debtor_warning_letters.deleteMany({
        where: { id: { in: warningLetterIds } },
      });
    }

    const marketingActivityIds = values("marketingActivity");
    if (marketingActivityIds.length > 0) {
      await prisma.debtor_marketing_activities.deleteMany({
        where: { id: { in: marketingActivityIds } },
      });
    }

    const marketingTimelineIds = values("marketingTimeline");
    if (marketingTimelineIds.length > 0) {
      await prisma.debtor_marketing_timelines.deleteMany({
        where: { id: { in: marketingTimelineIds } },
      });
    }

    const debtorDocumentIds = values("debtorDocument");
    if (debtorDocumentIds.length > 0) {
      await prisma.debtor_documents.deleteMany({
        where: { id: { in: debtorDocumentIds } },
      });
    }

    const incomingMailIds = values("incomingMail");
    if (incomingMailIds.length > 0) {
      await prisma.incoming_mails.deleteMany({
        where: { id: { in: incomingMailIds } },
      });
    }

    const outgoingMailIds = values("outgoingMail");
    if (outgoingMailIds.length > 0) {
      await prisma.outgoing_mails.deleteMany({
        where: { id: { in: outgoingMailIds } },
      });
    }

    const memorandumIds = values("memorandum");
    if (memorandumIds.length > 0) {
      await prisma.memorandums.deleteMany({
        where: { id: { in: memorandumIds } },
      });
    }

    const collateralIds = values("collateral");
    if (collateralIds.length > 0) {
      await prisma.debtor_collaterals.deleteMany({
        where: { id: { in: collateralIds } },
      });
    }

    const contractIds = values("contract");
    if (contractIds.length > 0) {
      await prisma.debtor_contracts.deleteMany({
        where: { id: { in: contractIds } },
      });
    }

    const debtorIds = values("debtor");
    if (debtorIds.length > 0) {
      await prisma.digital_debtors.deleteMany({
        where: { id: { in: debtorIds } },
      });
    }

    const userIds = values("user");
    if (userIds.length > 0) {
      await prisma.users.deleteMany({ where: { id: { in: userIds } } });
    }

    const roleIds = values("role");
    if (roleIds.length > 0) {
      await prisma.roles.deleteMany({ where: { id: { in: roleIds } } });
    }

    const divisionIds = values("division");
    if (divisionIds.length > 0) {
      await prisma.divisions.deleteMany({
        where: { id: { in: divisionIds } },
      });
    }
  }

  return {
    cleanup,
    label,
    name(value) {
      return `${value} ${runId.slice(0, 8)}`;
    },
    runId,
    track,
    userAgent,
    values,
  };
}

async function createActiveUser(prisma, fixture, options) {
  const suffix = fixture.runId.replace(/-/g, "").slice(0, 12);
  const username = String(options.username || `it_${suffix}`).toLowerCase();
  const password = options.password || `Integration-${suffix}-123!`;
  const user = await prisma.users.create({
    data: {
      id: crypto.randomUUID(),
      name: options.name || fixture.name("Integration User"),
      username,
      email: options.email || `${username}@integration.invalid`,
      password: await hashPassword(password),
      role_id: options.roleId,
      division_id: options.divisionId,
      is_active: true,
      onboarding_status: "ACTIVE",
      email_verified_at: new Date(),
      password_set_at: new Date(),
      activated_at: new Date(),
    },
  });
  fixture.track("user", user.id);
  return { password, user, username };
}

module.exports = {
  assertSafeIntegrationDatabase,
  buildAuthorization,
  createActiveUser,
  createIntegrationFixture,
  futureUtcDate,
  loginAgent,
  readAdminCredentials,
  waitFor,
};
