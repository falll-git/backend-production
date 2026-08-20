const { readFileSync, readdirSync } = require("node:fs");
const { join, relative, sep } = require("node:path");

const { expect, test } = require("@playwright/test");

// Cross-role fixture setup and cleanup use the controlled system client. Page
// navigation still authenticates each role through the real least-privilege API.
const prisma = require("../../src/config/prisma-system");
const {
  resolveFrontendDirectory,
} = require("../../scripts/release-quality-gate");
const {
  assertSafeIntegrationDatabase,
  createActiveUser,
  createIntegrationFixture,
} = require("../../src/integration/support/integration-test-helpers");

const ROLE_NAMES = ["Admin", "Staf", "Supervisor", "Manager"];
const EXPECTED_ROUTE_COUNTS = {
  Admin: 61,
  Staf: 36,
  Supervisor: 35,
  Manager: 36,
};
const RATE_LIMIT_SAFETY_MARGIN_MS = 500;
const RATE_LIMIT_MINIMUM_REMAINING = 40;
const API_IDLE_QUIET_MS = 500;
const API_IDLE_TIMEOUT_MS = 30_000;

function resolveRoleNames(env = process.env) {
  const requested = String(env.FULLSTACK_ROLE_SMOKE_ROLE || "").trim();
  if (!requested) return ROLE_NAMES;
  if (!ROLE_NAMES.includes(requested)) {
    throw new Error(
      `FULLSTACK_ROLE_SMOKE_ROLE tidak dikenal: ${requested}`,
    );
  }
  return [requested];
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function routeFromPageFile(appDirectory, file) {
  const relativeFile = relative(appDirectory, file);
  const route = `/${relativeFile
    .replace(new RegExp(`\\${sep}page\\.tsx$`), "")
    .split(sep)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .join("/")}`;
  return route === "/" ? "/" : route.replace(/\/$/, "");
}

function discoverStaticDashboardPages() {
  const frontendDirectory = resolveFrontendDirectory(process.env, process.cwd());
  const appDirectory = join(frontendDirectory, "src", "app");

  return new Map(
    walk(appDirectory)
      .filter((file) => file.endsWith(`${sep}page.tsx`))
      .filter((file) => !relative(appDirectory, file).includes("["))
      .map((file) => {
        const route = routeFromPageFile(appDirectory, file);
        const redirectTarget = readFileSync(file, "utf8").match(
          /\bredirect\(\s*["']([^"']+)["']\s*\)/,
        )?.[1];
        return [route, redirectTarget ?? null];
      })
      .filter(
        ([route]) => route === "/dashboard" || route.startsWith("/dashboard/"),
      ),
  );
}

function readNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function trackGeneralApiRateLimit(page) {
  let lowestRemaining = Number.POSITIVE_INFINITY;
  let resetAfterSeconds = 0;

  const handleResponse = (response) => {
    const headers = response.headers();
    const policyWindow = headers["ratelimit-policy"]?.match(
      /(?:^|;)\s*w=(\d+)(?:;|$)/i,
    );
    if (!policyWindow || Number(policyWindow[1]) !== 60) return;

    const remaining = readNonNegativeNumber(headers["ratelimit-remaining"]);
    const reset = readNonNegativeNumber(headers["ratelimit-reset"]);
    if (remaining === null || remaining > lowestRemaining) return;

    lowestRemaining = remaining;
    resetAfterSeconds = reset ?? resetAfterSeconds;
  };

  page.on("response", handleResponse);

  return {
    async waitForCapacity() {
      if (lowestRemaining > RATE_LIMIT_MINIMUM_REMAINING) return;

      const waitMs =
        Math.ceil(resetAfterSeconds * 1000) + RATE_LIMIT_SAFETY_MARGIN_MS;
      if (waitMs > 0) await page.waitForTimeout(waitMs);
      lowestRemaining = Number.POSITIVE_INFINITY;
      resetAfterSeconds = 0;
    },
    dispose() {
      page.off("response", handleResponse);
    },
  };
}

function trackApiRequests(page) {
  const inFlight = new Set();

  const isApplicationApiRequest = (request) => {
    try {
      return new URL(request.url()).pathname.startsWith("/api/");
    } catch {
      return false;
    }
  };
  const handleRequest = (request) => {
    if (isApplicationApiRequest(request)) inFlight.add(request);
  };
  const handleSettled = (request) => {
    inFlight.delete(request);
  };

  page.on("request", handleRequest);
  page.on("requestfinished", handleSettled);
  page.on("requestfailed", handleSettled);

  return {
    async waitForIdle(label) {
      const deadline = Date.now() + API_IDLE_TIMEOUT_MS;
      let idleSince = null;

      while (Date.now() < deadline) {
        if (inFlight.size === 0) {
          idleSince ??= Date.now();
          if (Date.now() - idleSince >= API_IDLE_QUIET_MS) return;
        } else {
          idleSince = null;
        }
        await page.waitForTimeout(100);
      }

      const pendingPaths = [...inFlight].map((request) => {
        try {
          return new URL(request.url()).pathname;
        } catch {
          return "request-tidak-dikenal";
        }
      });
      throw new Error(
        `${label} masih memiliki ${inFlight.size} request API aktif: ${[
          ...new Set(pendingPaths),
        ].join(", ")}`,
      );
    },
    dispose() {
      page.off("request", handleRequest);
      page.off("requestfinished", handleSettled);
      page.off("requestfailed", handleSettled);
      inFlight.clear();
    },
  };
}

async function loginFromUi(page, account) {
  await page.goto("/");
  await page.getByLabel("Username").fill(account.username);
  await page.locator("input#password").fill(account.password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: /Assalamualaikum/i }),
  ).toBeVisible();
}

test("seluruh role dapat membuka setiap menu halaman yang memiliki izin baca", async ({
  browser,
}, testInfo) => {
  test.setTimeout(30 * 60_000);
  assertSafeIntegrationDatabase("Full-stack role menu smoke");

  const fixture = createIntegrationFixture(prisma, "Full-stack role menu smoke", {
    runId: process.env.FULLSTACK_TEST_RUN_ID,
    userAgent: process.env.FULLSTACK_TEST_USER_AGENT,
  });
  const staticPages = discoverStaticDashboardPages();
  const staticRoutes = new Set(staticPages.keys());
  const contexts = [];
  const report = [];
  const roleNames = resolveRoleNames();

  try {
    expect(staticRoutes.size).toBe(61);

    const [roles, division] = await Promise.all([
      prisma.roles.findMany({
        where: { name: { in: roleNames } },
        include: {
          roles_menus: {
            where: { can_read: true },
            include: { menu: true },
          },
        },
      }),
      prisma.divisions.findFirst({ orderBy: { created_at: "asc" } }),
    ]);
    expect(division, "Divisi baseline wajib tersedia").not.toBeNull();
    expect(roles.map((role) => role.name).sort()).toEqual([...roleNames].sort());

    const rolesByName = new Map(roles.map((role) => [role.name, role]));

    for (const roleName of roleNames) {
      const role = rolesByName.get(roleName);
      const readableMenus = role.roles_menus
        .map((permission) => permission.menu)
        .filter((menu) => menu.url.startsWith("/dashboard"));
      const pageRoutes = [...new Set(
        readableMenus
          .map((menu) => menu.url)
          .filter((url) => staticRoutes.has(url)),
      )].sort();
      const nonPageMenus = readableMenus.filter(
        (menu) => !staticRoutes.has(menu.url),
      );

      expect(pageRoutes).toHaveLength(EXPECTED_ROUTE_COUNTS[roleName]);
      for (const menu of nonPageMenus) {
        expect(menu.menu_type, `${menu.url} bukan route halaman`).toBe(
          "DASHBOARD_WIDGET",
        );
        expect(menu.placement).toBe("DASHBOARD");
        expect(menu.render_in_sidebar).toBe(false);
        expect(menu.component_key).toBeTruthy();
      }

      const suffix = fixture.runId.replace(/-/g, "").slice(0, 8);
      const account = await createActiveUser(prisma, fixture, {
        roleId: role.id,
        divisionId: division.id,
        username: `fs_${roleName.toLowerCase()}_${suffix}`,
        name: fixture.name(`Smoke ${roleName}`),
      });
      const context = await browser.newContext({
        locale: "id-ID",
        timezoneId: "Asia/Jakarta",
        userAgent: process.env.FULLSTACK_TEST_USER_AGENT,
      });
      contexts.push(context);
      const page = await context.newPage();
      const rateLimitBudget = trackGeneralApiRateLimit(page);
      const apiRequests = trackApiRequests(page);
      let activeRoute = "/";
      const serverErrors = [];
      const recoveredRefreshUnavailable = [];
      const pageErrors = [];

      page.on("response", (response) => {
        if (
          response.status() === 503 &&
          new URL(response.url()).pathname === "/api/v1/auth/refresh"
        ) {
          recoveredRefreshUnavailable.push({
            route: activeRoute,
            status: response.status(),
          });
          return;
        }
        if (response.status() >= 500) {
          serverErrors.push({
            route: activeRoute,
            status: response.status(),
            url: response.url(),
          });
        }
      });
      page.on("pageerror", (error) => {
        pageErrors.push({ route: activeRoute, message: error.message });
      });

      try {
        await loginFromUi(page, account);
        // Dashboard memuat beberapa ringkasan setelah shell tampil. Tunggu
        // request aktual selesai agar direct-route smoke tidak membatalkan
        // query yang masih berjalan dan membawanya ke route atau role berikut.
        await apiRequests.waitForIdle(`${roleName} setelah login`);

        for (const route of pageRoutes) {
          activeRoute = route;
          await page.goto(route, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });
          await expect(
            page.getByRole("status", { name: "Menyiapkan halaman" }),
            `${roleName} masih tertahan pada loader saat membuka ${route}`,
          ).toBeHidden({ timeout: 30_000 });
          await expect(
            page.locator("main"),
            `${roleName} tidak menampilkan konten utama untuk ${route}`,
          ).toBeVisible({ timeout: 15_000 });
          const actualUrl = new URL(page.url());
          const redirectTarget = staticPages.get(route);
          if (redirectTarget) {
            const expectedUrl = new URL(redirectTarget, page.url());
            await expect
              .poll(() => {
                const currentUrl = new URL(page.url());
                return `${currentUrl.pathname}${currentUrl.hash}`;
              })
              .toBe(`${expectedUrl.pathname}${expectedUrl.hash}`);
          } else {
            expect(actualUrl.pathname).toBe(route);
          }
          // Hindari networkidle browser karena layout memang melakukan polling.
          // Pelacak ini hanya menunggu request API aplikasi yang benar-benar
          // aktif, termasuk body response, sebelum route selanjutnya dibuka.
          await apiRequests.waitForIdle(`${roleName} pada ${route}`);
          await rateLimitBudget.waitForCapacity();
        }
      } finally {
        apiRequests.dispose();
        rateLimitBudget.dispose();
        await context.close();
      }

      expect(serverErrors, `${roleName} menerima respons server 5xx`).toEqual([]);
      expect(
        recoveredRefreshUnavailable.length,
        `${roleName} terlalu sering membutuhkan pemulihan refresh transient`,
      ).toBeLessThanOrEqual(1);
      expect(pageErrors, `${roleName} mengalami crash JavaScript`).toEqual([]);
      report.push({
        role: roleName,
        page_routes: pageRoutes.length,
        redirect_routes: pageRoutes.filter((route) => staticPages.get(route))
          .length,
        dashboard_widgets: nonPageMenus.length,
        recovered_refresh_unavailable: recoveredRefreshUnavailable.length,
      });
      console.log(
        `[role-menu-smoke] ${roleName}: ${pageRoutes.length} route halaman, ${nonPageMenus.length} widget`,
      );
    }

    await testInfo.attach("role-menu-smoke-coverage", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    await fixture.cleanup();
  }
});
