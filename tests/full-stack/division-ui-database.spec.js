const crypto = require("node:crypto");
const { test, expect } = require("@playwright/test");
const prisma = require("../../src/config/prisma");
const {
  assertLoopbackUrl,
} = require("../../scripts/release-quality-gate");
const {
  assertSafeIntegrationDatabase,
  createIntegrationFixture,
} = require("../../src/integration/support/integration-test-helpers");

function assertSafeFrontendTarget() {
  assertLoopbackUrl(
    process.env.FULLSTACK_FRONTEND_URL || "http://localhost:3000",
    "FULLSTACK_FRONTEND_URL",
  );
}

test("Admin mengelola divisi dari UI dan perubahan terbukti di PostgreSQL", async ({
  page,
}) => {
  assertSafeIntegrationDatabase("Full-stack division UI");
  assertSafeFrontendTarget();
  const fixture = createIntegrationFixture(prisma, "Full-stack division UI", {
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

  const suffix = crypto.randomUUID().slice(0, 8);
  const initialName = `UI DB Workflow ${suffix}`;
  const updatedName = `UI DB Updated ${suffix}`;

  try {
    await page.goto("/");
    await page.getByLabel("Username").fill(username);
    await page.locator("input#password").fill(password);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 30000 });

    await page.goto("/dashboard/parameter/divisi");
    await expect(
      page.getByRole("heading", { name: "Master Divisi" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Tambah Divisi" }).click();
    let dialog = page.getByRole("dialog", { name: "Tambah Divisi" });
    await dialog.getByPlaceholder("Masukkan nama divisi").fill(initialName);
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await expect(
      page.getByRole("row").filter({ hasText: initialName }),
    ).toBeVisible();

    const created = await prisma.divisions.findFirst({
      where: { name: initialName },
    });
    expect(created?.name).toBe(initialName);
    fixture.track("division", created.id);

    await page.getByLabel("Cari Data").fill(initialName);
    let row = page.getByRole("row").filter({ hasText: initialName });
    let actionButton = row.getByRole("button", {
      name: "Buka aksi divisi",
    });
    await actionButton.click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(actionButton).toHaveAttribute("aria-expanded", "false");

    dialog = page.getByRole("dialog", { name: "Edit Divisi" });
    await dialog.getByPlaceholder("Masukkan nama divisi").fill(updatedName);
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await page.getByLabel("Cari Data").fill(updatedName);
    await expect(
      page.getByRole("row").filter({ hasText: updatedName }),
    ).toBeVisible();

    const updated = await prisma.divisions.findUnique({
      where: { id: created.id },
    });
    expect(updated?.name).toBe(updatedName);

    row = page.getByRole("row").filter({ hasText: updatedName });
    actionButton = row.getByRole("button", { name: "Buka aksi divisi" });
    await expect(actionButton).toHaveAttribute("aria-expanded", "false");
    await actionButton.click();
    await expect(actionButton).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("menuitem", { name: "Hapus" }).click();

    dialog = page.getByRole("dialog", { name: "Hapus Divisi?" });
    await dialog.getByRole("button", { name: "Hapus", exact: true }).click();
    await expect(page.getByText(updatedName, { exact: true })).toHaveCount(0);

    const deleted = await prisma.divisions.findUnique({
      where: { id: created.id },
    });
    expect(deleted).toBeNull();
  } finally {
    await fixture.cleanup();
  }
});
