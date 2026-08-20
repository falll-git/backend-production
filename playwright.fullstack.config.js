const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { defineConfig, devices } = require("@playwright/test");
const { loadEnv } = require("./src/config/env");
const {
  assertLoopbackUrl,
  resolveBackendHealthUrl,
  resolveFrontendDirectory,
  resolveUrlPort,
} = require("./scripts/release-quality-gate");

loadEnv();

const backendDirectory = __dirname;
const frontendDirectory = resolveFrontendDirectory(
  process.env,
  backendDirectory,
);
const frontendUrl =
  process.env.FULLSTACK_FRONTEND_URL || "http://localhost:3000";
const backendHealthUrl = resolveBackendHealthUrl(process.env).href;
const fullStackRunId =
  process.env.FULLSTACK_TEST_RUN_ID || crypto.randomUUID();
const fullStackUserAgent =
  process.env.FULLSTACK_TEST_USER_AGENT ||
  `RuwangArsipFullStack/${fullStackRunId}`;
process.env.FULLSTACK_TEST_RUN_ID = fullStackRunId;
process.env.FULLSTACK_TEST_USER_AGENT = fullStackUserAgent;

const frontendTarget = assertLoopbackUrl(
  frontendUrl,
  "FULLSTACK_FRONTEND_URL",
);
const reuseFrontendBuildValue = String(
  process.env.FULLSTACK_REUSE_FRONTEND_BUILD || "false",
).trim().toLowerCase();
if (!["true", "false"].includes(reuseFrontendBuildValue)) {
  throw new Error(
    "FULLSTACK_REUSE_FRONTEND_BUILD hanya menerima true atau false.",
  );
}
const reuseFrontendBuild = reuseFrontendBuildValue === "true";
if (reuseFrontendBuild) {
  const buildIdPath = path.join(frontendDirectory, ".next", "BUILD_ID");
  if (
    !fs.existsSync(buildIdPath) ||
    !fs.readFileSync(buildIdPath, "utf8").trim()
  ) {
    throw new Error(
      "FULLSTACK_REUSE_FRONTEND_BUILD=true tetapi build production frontend tidak tersedia.",
    );
  }
}

module.exports = defineConfig({
  testDir: "./tests/full-stack",
  globalTeardown: require.resolve("./tests/full-stack/global-teardown"),
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"]],
  outputDir: "test-results/full-stack",
  use: {
    ...devices["Desktop Chrome"],
    userAgent: fullStackUserAgent,
    baseURL: frontendUrl,
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      name: "backend",
      command: "npm run start",
      cwd: backendDirectory,
      url: backendHealthUrl,
      reuseExistingServer: false,
      // Startup dependency checks normalnya selesai <1 detik, tetapi spawning
      // proses Node di Windows CI/local dapat tertunda saat artefak browser
      // sedang difinalisasi. Samakan budget harness dengan frontend agar gate
      // tidak flaky; ini tidak mengubah timeout runtime production.
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        CORS_ORIGIN: frontendTarget.origin,
        FRONTEND_URL: frontendTarget.origin,
      },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
    {
      name: "frontend",
      command: reuseFrontendBuild ? "npm run start" : "npm run test:e2e:server",
      cwd: frontendDirectory,
      url: frontendUrl,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(resolveUrlPort(frontendTarget)),
      },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
  ],
});
