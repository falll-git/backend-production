const crypto = require("node:crypto");

const { test, expect } = require("@playwright/test");

// Setup, direct database assertions, and cleanup intentionally use the system
// client. The browser/API under test continues to use the least-privilege
// runtime client, so this does not bypass RLS in the application path.
const prisma = require("../../src/config/prisma-system");
const { comparePassword, hashPassword } = require("../../src/utils/bcrypt");
const {
  generatePlainToken,
  hashToken,
} = require("../../src/utils/auth-onboarding");
const {
  generateAccessToken,
  verifyAccessToken,
} = require("../../src/utils/jwt");
const {
  assertLoopbackUrl,
} = require("../../scripts/release-quality-gate");
const {
  assertSafeIntegrationDatabase,
  createIntegrationFixture,
} = require("../../src/integration/support/integration-test-helpers");

function assertSafeTargets() {
  assertSafeIntegrationDatabase("Full-stack autentikasi");
  assertLoopbackUrl(
    process.env.FULLSTACK_FRONTEND_URL || "http://localhost:3000",
    "FULLSTACK_FRONTEND_URL",
  );
}

async function baselineRoleAndDivision() {
  const [role, division] = await Promise.all([
    prisma.roles.findFirst({
      where: { name: { equals: "Admin", mode: "insensitive" } },
    }),
    prisma.divisions.findFirst({ orderBy: { created_at: "asc" } }),
  ]);
  expect(role, "Role Admin baseline wajib tersedia").not.toBeNull();
  expect(division, "Divisi baseline wajib tersedia").not.toBeNull();
  return { division, role };
}

async function createAuthUser(fixture, purpose, options = {}) {
  const { division, role } = await baselineRoleAndDivision();
  const compactRunId = fixture.runId.replace(/-/g, "");
  const suffix = compactRunId.slice(0, 12);
  const emailMarker = `${suffix}.${compactRunId.slice(-8)}`;
  const username = `fs_${purpose}_${suffix}`.toLowerCase();
  const password = options.password || `FullStack-${purpose}-${suffix}-123!`;
  const active = options.active !== false;
  const user = await prisma.users.create({
    data: {
      id: crypto.randomUUID(),
      name: `Full-stack ${purpose} ${fixture.runId}`,
      username,
      email: `${purpose}.${emailMarker}@fullstack.example.com`,
      password: await hashPassword(password),
      role_id: role.id,
      division_id: division.id,
      is_active: active,
      onboarding_status: options.onboardingStatus || "ACTIVE",
      email_verified_at: options.passwordSet === false ? null : new Date(),
      password_set_at: options.passwordSet === false ? null : new Date(),
      activated_at: options.passwordSet === false ? null : new Date(),
    },
  });
  fixture.track("user", user.id);
  return { password, user, username };
}

async function loginFromUi(page, username, password) {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.locator("input#password").fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
}

function createFixture(label) {
  assertSafeTargets();
  return createIntegrationFixture(prisma, label, {
    runId: `${process.env.FULLSTACK_TEST_RUN_ID}-${crypto.randomUUID()}`,
    userAgent: process.env.FULLSTACK_TEST_USER_AGENT,
  });
}

test("forgot, set, reset, dan change password berjalan dari UI sampai PostgreSQL", async ({
  page,
}) => {
  const fixture = createFixture("Full-stack auth password lifecycle");
  const resetUser = await createAuthUser(fixture, "reset");
  const inviteUser = await createAuthUser(fixture, "invite", {
    onboardingStatus: "PENDING_ACTIVATION",
    passwordSet: false,
  });
  const changeUser = await createAuthUser(fixture, "change");
  const resetPassword = `Reset-${fixture.runId.slice(0, 12)}-123!`;
  const invitePassword = `Invite-${fixture.runId.slice(0, 12)}-123!`;
  const changedPassword = `Changed-${fixture.runId.slice(0, 12)}-123!`;

  try {
    const forgotStartedAt = new Date();
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(resetUser.user.email);
    await page
      .getByRole("button", { name: "KIRIM LINK RESET", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Cek Email Anda" }),
    ).toBeVisible();

    const forgotToken = await prisma.auth_action_tokens.findFirst({
      where: {
        user_id: resetUser.user.id,
        type: "RESET_PASSWORD",
        created_at: { gte: forgotStartedAt },
        used_at: null,
      },
      orderBy: { created_at: "desc" },
    });
    expect(forgotToken, "Forgot password wajib menerbitkan token DB").not.toBeNull();
    expect(forgotToken.token_hash).toMatch(/^[a-f0-9]{64}$/);

    const resetToken = generatePlainToken();
    await prisma.auth_action_tokens.updateMany({
      where: {
        user_id: resetUser.user.id,
        type: "RESET_PASSWORD",
        used_at: null,
      },
      data: { used_at: new Date() },
    });
    const seededResetToken = await prisma.auth_action_tokens.create({
      data: {
        user_id: resetUser.user.id,
        type: "RESET_PASSWORD",
        token_hash: hashToken(resetToken),
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    await page.goto(`/reset-password?token=${encodeURIComponent(resetToken)}`);
    await expect(
      page.getByRole("heading", { name: "Reset Password" }),
    ).toBeVisible();
    await page.getByLabel("Password Baru", { exact: true }).fill(resetPassword);
    await page
      .getByLabel("Konfirmasi Password", { exact: true })
      .fill(resetPassword);
    await page
      .getByRole("button", { name: "SIMPAN PASSWORD BARU", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Password Berhasil Diperbarui" }),
    ).toBeVisible();

    let storedResetUser = await prisma.users.findUnique({
      where: { id: resetUser.user.id },
    });
    expect(await comparePassword(resetPassword, storedResetUser.password)).toBe(true);
    expect(
      (
        await prisma.auth_action_tokens.findUnique({
          where: { id: seededResetToken.id },
        })
      ).used_at,
    ).not.toBeNull();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Link Reset Tidak Valid" }),
    ).toBeVisible();

    const inviteToken = generatePlainToken();
    const seededInviteToken = await prisma.auth_action_tokens.create({
      data: {
        user_id: inviteUser.user.id,
        type: "INVITE",
        token_hash: hashToken(inviteToken),
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    await page.goto(`/set-password?token=${encodeURIComponent(inviteToken)}`);
    await expect(
      page.getByRole("heading", { name: "Aktivasi Akun" }),
    ).toBeVisible();
    await page.getByLabel("Password Baru", { exact: true }).fill(invitePassword);
    await page
      .getByLabel("Konfirmasi Password", { exact: true })
      .fill(invitePassword);
    await page
      .getByRole("button", {
        name: "SIMPAN DAN AKTIFKAN AKUN",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Akun Berhasil Diaktifkan" }),
    ).toBeVisible();

    const storedInviteUser = await prisma.users.findUnique({
      where: { id: inviteUser.user.id },
    });
    expect(storedInviteUser.onboarding_status).toBe("ACTIVE");
    expect(storedInviteUser.password_set_at).not.toBeNull();
    expect(await comparePassword(invitePassword, storedInviteUser.password)).toBe(true);
    expect(
      (
        await prisma.auth_action_tokens.findUnique({
          where: { id: seededInviteToken.id },
        })
      ).used_at,
    ).not.toBeNull();

    await loginFromUi(page, changeUser.username, changeUser.password);
    await expect(page).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 30000 });
    await page.goto("/dashboard/account/security");
    await expect(
      page.getByRole("heading", { name: "Profil", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Password saat ini", { exact: true }).fill(changeUser.password);
    await page.getByLabel("Password baru", { exact: true }).fill(changedPassword);
    await page.getByLabel("Konfirmasi password baru").fill(changedPassword);
    await page.getByRole("button", { name: "Ganti password" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 30000 });

    const storedChangedUser = await prisma.users.findUnique({
      where: { id: changeUser.user.id },
    });
    expect(await comparePassword(changedPassword, storedChangedUser.password)).toBe(true);
    expect(
      await prisma.refresh_tokens.count({
        where: { user_id: changeUser.user.id, revoked_at: null },
      }),
    ).toBe(0);

    await loginFromUi(page, changeUser.username, changeUser.password);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(/Username atau password tidak sesuai/i)).toBeVisible();
    await loginFromUi(page, changeUser.username, changedPassword);
    await expect(page).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 30000 });
  } finally {
    await fixture.cleanup();
  }
});

test("login kedua mencabut sesi browser pertama", async ({ browser }) => {
  const fixture = createFixture("Full-stack single session");
  const account = await createAuthUser(fixture, "single");
  const contextOne = await browser.newContext();
  const contextTwo = await browser.newContext();
  const firstPage = await contextOne.newPage();
  const secondPage = await contextTwo.newPage();

  try {
    await loginFromUi(firstPage, account.username, account.password);
    await expect(firstPage).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 30000 });
    const firstSession = await prisma.refresh_tokens.findFirst({
      where: { user_id: account.user.id, revoked_at: null },
    });
    expect(firstSession).not.toBeNull();

    await loginFromUi(secondPage, account.username, account.password);
    await expect(secondPage).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 30000 });
    const activeSessions = await prisma.refresh_tokens.findMany({
      where: { user_id: account.user.id, revoked_at: null },
    });
    expect(activeSessions).toHaveLength(1);
    expect(activeSessions[0].id).not.toBe(firstSession.id);

    await firstPage.goto("/dashboard/account/security");
    await expect(firstPage).toHaveURL(/\/$/, { timeout: 30000 });
    await secondPage.goto("/dashboard/account/security");
    await expect(
      secondPage.getByRole("heading", { name: "Profil", exact: true }),
    ).toBeVisible();
  } finally {
    await Promise.all([contextOne.close(), contextTwo.close()]);
    await fixture.cleanup();
  }
});

test("dua belas reload cepat tidak menghapus sesi aktif", async ({ page }) => {
  const fixture = createFixture("Full-stack rapid reload session");
  const account = await createAuthUser(fixture, "rapid-reload");
  const internalErrors = [];

  page.on("response", (response) => {
    if (response.status() >= 500 && response.status() !== 503) {
      internalErrors.push({
        status: response.status(),
        url: response.url(),
      });
    }
  });

  try {
    await loginFromUi(page, account.username, account.password);
    await expect(page).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 30_000 });

    for (let index = 0; index < 12; index += 1) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(100);
    }

    await expect(page).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: /Assalamualaikum/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    expect(internalErrors).toEqual([]);
    expect(
      await prisma.refresh_tokens.count({
        where: { user_id: account.user.id, revoked_at: null },
      }),
    ).toBe(1);
  } finally {
    await fixture.cleanup();
  }
});

test("access token kedaluwarsa dipulihkan dan sesi kedaluwarsa memaksa login ulang", async ({
  page,
}) => {
  const fixture = createFixture("Full-stack token expiry");
  const account = await createAuthUser(fixture, "expiry");
  let interceptedSessionId = null;

  try {
    await page.route("**/api/v1/auth/login", async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      const liveToken = payload?.data?.token;
      expect(typeof liveToken).toBe("string");
      const claims = verifyAccessToken(liveToken);
      interceptedSessionId = claims.session_id;

      const previousExpiry = process.env.JWT_EXPIRES_IN;
      process.env.JWT_EXPIRES_IN = "1s";
      let expiringToken;
      try {
        expiringToken = generateAccessToken({
          id: claims.id,
          username: claims.username,
          role_id: claims.role_id,
          division_id: claims.division_id,
          session_id: claims.session_id,
          amr: claims.amr,
        });
      } finally {
        process.env.JWT_EXPIRES_IN = previousExpiry;
      }

      await route.fulfill({
        response,
        json: {
          ...payload,
          data: { ...payload.data, token: expiringToken },
        },
      });
    });

    await loginFromUi(page, account.username, account.password);
    await expect(page).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 30000 });
    await page.unroute("**/api/v1/auth/login");
    await page.waitForTimeout(1200);

    await page.goto("/dashboard/account/security");
    await expect(
      page.getByRole("heading", { name: "Profil", exact: true }),
    ).toBeVisible();
    const refreshedSession = await prisma.refresh_tokens.findFirst({
      where: { user_id: account.user.id, revoked_at: null },
    });
    expect(refreshedSession).not.toBeNull();
    expect(refreshedSession.id).not.toBe(interceptedSessionId);

    await prisma.refresh_tokens.update({
      where: { id: refreshedSession.id },
      data: { expires_at: new Date(Date.now() - 1000) },
    });

    // AuthProvider dapat mengalihkan halaman ke login sebelum navigasi reload
    // selesai. Chromium melaporkan perlombaan yang memang diharapkan ini sebagai
    // ERR_ABORTED walaupun tujuan akhirnya sudah benar. Abaikan hanya abort
    // tersebut; kegagalan navigasi lain tetap harus menggagalkan pengujian.
    await page.reload({ waitUntil: "domcontentloaded" }).catch((error) => {
      if (!String(error?.message).includes("net::ERR_ABORTED")) {
        throw error;
      }
    });
    await expect(page).toHaveURL(/\/$/, { timeout: 30000 });
  } finally {
    await fixture.cleanup();
  }
});
