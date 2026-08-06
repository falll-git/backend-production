const { test, expect } = require("@playwright/test");

const prisma = require("../../src/config/prisma");
const {
  assertLoopbackUrl,
} = require("../../scripts/release-quality-gate");
const {
  assertSafeIntegrationDatabase,
  createIntegrationFixture,
  futureUtcDate,
} = require("../../src/integration/support/integration-test-helpers");

function assertSafeTargets() {
  assertSafeIntegrationDatabase("Full-stack agunan");
  assertLoopbackUrl(
    process.env.FULLSTACK_FRONTEND_URL || "http://localhost:3000",
    "FULLSTACK_FRONTEND_URL",
  );
}

test("Admin mengatur expired agunan dari UI dan status tersimpan di PostgreSQL", async ({
  page,
}) => {
  assertSafeTargets();
  const fixture = createIntegrationFixture(prisma, "Full-stack collateral UI", {
    runId: process.env.FULLSTACK_TEST_RUN_ID,
    userAgent: process.env.FULLSTACK_TEST_USER_AGENT,
  });
  const username =
    process.env.API_TEST_ADMIN_USERNAME || process.env.SEED_ADMIN_USERNAME;
  const password =
    process.env.API_TEST_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("Kredensial API_TEST_ADMIN wajib diisi untuk full-stack test.");
  }

  const admin = await prisma.users.findUnique({
    where: { username: username.toLowerCase() },
  });
  expect(admin).not.toBeNull();
  const collateralNumber = `IT-UI-AGUNAN-${fixture.runId.slice(0, 8)}`;
  const debtor = await prisma.digital_debtors.create({
    data: {
      debtor_number: `IT-UI-DEBTOR-${fixture.runId.slice(0, 8)}`,
      name: fixture.name("Debitur UI Agunan"),
      status: "ACTIVE",
      customer_type: "INDIVIDUAL",
      created_by: admin.id,
    },
  });
  fixture.track("debtor", debtor.id);
  const collateral = await prisma.debtor_collaterals.create({
    data: {
      debtor_id: debtor.id,
      collateral_number: collateralNumber,
      collateral_type: "SHGB",
      owner_name: fixture.name("Pemilik Agunan"),
      proof_number: `IT-BUKTI-${fixture.runId.slice(0, 8)}`,
      address: "Lokasi fixture full-stack",
      market_value: 250000000,
      appraisal_value: 225000000,
      reporter_appraisal_date: futureUtcDate({ months: -11 }),
      description: "Fixture full-stack monitoring agunan",
      period_month: "202607",
      created_by: admin.id,
    },
  });
  fixture.track("collateral", collateral.id);

  try {
    await page.goto("/");
    await page.getByLabel("Username").fill(username);
    await page.locator("input#password").fill(password);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 30000 });

    await page.goto("/dashboard/informasi-debitur");
    await page.getByRole("button", { name: /Agunan A01/ }).click();
    let row = page.getByRole("row").filter({ hasText: collateralNumber });
    await expect(row).toBeVisible();

    await row
      .getByRole("button", { name: `Aksi agunan ${collateralNumber}` })
      .click();
    await page
      .getByRole("menuitem", { name: "Atur Monitoring Expired" })
      .click();

    let dialog = page.getByRole("dialog", { name: "Atur Monitoring Expired" });
    await dialog.locator("#collateral-has-expiry-date").selectOption("true");
    const expiryDate = futureUtcDate({ months: 2 }).toISOString().slice(0, 10);
    await dialog.locator("#collateral-expiry-date").fill(expiryDate);
    await dialog
      .locator("#collateral-expiry-note")
      .fill("Perpanjangan diuji melalui UI full-stack");
    await dialog.getByRole("button", { name: "Simpan", exact: true }).click();
    await expect(page.getByText("Monitoring expired agunan diperbarui")).toBeVisible();

    row = page.getByRole("row").filter({ hasText: collateralNumber });
    await expect(row.getByText("Segera Berakhir", { exact: true })).toBeVisible();
    await expect(row).toContainText("Tanggal expired");
    await expect(row).toContainText("Segera Ditinjau Ulang");
    let stored = await prisma.debtor_collaterals.findUnique({
      where: { id: collateral.id },
    });
    expect(stored.has_expiry_date).toBe(true);
    expect(stored.expiry_date.toISOString().slice(0, 10)).toBe(expiryDate);
    expect(stored.expiry_note).toBe("Perpanjangan diuji melalui UI full-stack");
    expect(stored.expiry_updated_by).toBe(admin.id);

    await row
      .getByRole("button", { name: `Aksi agunan ${collateralNumber}` })
      .click();
    await page
      .getByRole("menuitem", { name: "Atur Monitoring Expired" })
      .click();
    dialog = page.getByRole("dialog", { name: "Atur Monitoring Expired" });
    await expect(dialog.getByText(/Perubahan terakhir oleh/)).toBeVisible();
    await dialog.locator("#collateral-has-expiry-date").selectOption("false");
    await dialog.getByRole("button", { name: "Simpan", exact: true }).click();

    row = page.getByRole("row").filter({ hasText: collateralNumber });
    await expect(row.getByText("Tidak Berlaku", { exact: true })).toBeVisible();
    await expect(row).toContainText("Belum ada sumber");
    stored = await prisma.debtor_collaterals.findUnique({
      where: { id: collateral.id },
    });
    expect(stored.has_expiry_date).toBe(false);
    expect(stored.expiry_date).toBeNull();
    expect(stored.expiry_updated_by).toBe(admin.id);
  } finally {
    await fixture.cleanup();
  }
});
