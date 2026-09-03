const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const deploymentRoot = path.resolve(__dirname, "..", "..", "ops", "deployment");
const nginxRoot = path.resolve(__dirname, "..", "..", "ops", "nginx");

function loadPm2Template() {
  const filename = path.join(deploymentRoot, "ecosystem.config.cjs.example");
  const source = fs.readFileSync(filename, "utf8");
  const moduleRecord = { exports: {} };
  const sandboxProcess = {
    env: {
      RUWANG_DEPLOY_ROOT: path.resolve("/srv/ruwang/demo"),
      RUWANG_INSTANCE: "demo",
      DEPLOY_COMMIT_SHA: "a".repeat(40),
      RUWANG_FRONTEND_PORT: "3000",
      RUWANG_API_PORT: "7111",
    },
    execPath: process.execPath,
  };
  vm.runInNewContext(
    `(function (require, module, process) { ${source}\n})(require, module, process);`,
    { require, module: moduleRecord, process: sandboxProcess },
    { filename },
  );
  return { config: moduleRecord.exports, source };
}

test("template PM2 mendaftarkan lima proses production tanpa credential", () => {
  const { config, source } = loadPm2Template();
  assert.equal(config.apps.length, 5);
  assert.deepEqual(
    Array.from(config.apps, (entry) => entry.name),
    [
      "demo-frontend",
      "demo-api",
      "demo-slik-import-worker",
      "demo-watermark-worker",
      "demo-seputar-jaminan-worker",
    ],
  );
  assert.deepEqual(
    Array.from(config.apps.slice(1), (entry) => entry.env.RUNTIME_ROLE),
    ["api", "slik-import-worker", "watermark-worker", "seputar-jaminan-worker"],
  );
  assert.equal(config.apps.every((entry) => entry.exec_mode === "fork"), true);
  assert.equal(config.apps.every((entry) => entry.instances === 1), true);
  assert.equal(config.apps.every((entry) => entry.cwd.includes(`${path.sep}current${path.sep}`)), true);
  assert.equal(config.apps.every((entry) => entry.args[0].startsWith("--env-file=")), true);
  assert.equal(
    config.apps.every(
      (entry) => entry.env.RUWANG_DEPLOY_ROOT === path.resolve("/srv/ruwang/demo"),
    ),
    true,
  );
  assert.equal(config.apps[0].env.NEXT_DEPLOYMENT_ID, "a".repeat(40));
  assert.equal(config.apps[0].env.NEXT_PUBLIC_APP_RELEASE, "a".repeat(40));
  assert.doesNotMatch(source, /(?:password|private[_-]?key|api[_-]?key)\s*[:=]\s*["'][^"']+/i);
});

test("template Nginx memisahkan origin publik dari port loopback dan tetap belum dirender", () => {
  const source = fs.readFileSync(
    path.join(nginxRoot, "ruwang-domain.conf.example"),
    "utf8",
  );
  for (const token of [
    "__RUWANG_DOMAIN__",
    "__TLS_CERTIFICATE_PATH__",
    "__TLS_CERTIFICATE_KEY_PATH__",
    "__RUWANG_API_PORT__",
    "__RUWANG_FRONTEND_PORT__",
  ]) {
    assert.match(source, new RegExp(token));
  }
  assert.match(source, /location \/api\//);
  assert.match(source, /proxy_pass http:\/\/127\.0\.0\.1:__RUWANG_API_PORT__/);
  assert.match(source, /proxy_pass http:\/\/127\.0\.0\.1:__RUWANG_FRONTEND_PORT__/);
  assert.match(source, /http2 on;/);
  assert.doesNotMatch(source, /listen 443 ssl http2/);
  assert.doesNotMatch(source, /\$host/);
  assert.doesNotMatch(source, /103\.118\.175\.59|vmbprs|@123/i);
});

test("layout release mengunci approval, symlink, shared storage, dan rollback aplikasi saja", () => {
  const layout = JSON.parse(
    fs.readFileSync(path.join(deploymentRoot, "release-layout.json"), "utf8"),
  );
  assert.equal(layout.strategy, "manual-atomic-symlink");
  assert.equal(layout.automatic_deployment, false);
  assert.equal(layout.approval_required, true);
  assert.equal(layout.paths.current, "current");
  assert.equal(layout.shared_paths.includes("uploads"), true);
  assert.equal(layout.shared_paths.includes("seputar-jaminan-public"), true);
  assert.deepEqual(layout.post_activation_checks, [
    "pm2-five-processes-online",
    "api-health-ready",
    "frontend-http-ok",
  ]);
  assert.equal(layout.rollback.scope, "application-release-only");
  assert.equal(layout.rollback.database_migrations, "forward-only");
  assert.equal(layout.rollback.deletes_release, false);
});
