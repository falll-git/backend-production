const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_TEMPLATE_PATH,
  renderNginxConfigFile,
  renderNginxTemplate,
} = require("./nginx-release-template");

function validValues() {
  return {
    domain: "demo.ruwangarsip.id",
    apiPort: "7111",
    frontendPort: "3000",
    tlsCertificatePath: "/etc/letsencrypt/live/demo/fullchain.pem",
    tlsCertificateKeyPath: "/etc/letsencrypt/live/demo/privkey.pem",
  };
}

test("renderer Nginx mengisi seluruh token tanpa mengubah rute API", () => {
  const templateSource = fs.readFileSync(DEFAULT_TEMPLATE_PATH, "utf8");
  const result = renderNginxTemplate({ templateSource, ...validValues() });
  assert.doesNotMatch(result, /__[A-Z0-9_]+__/);
  assert.match(result, /server_name demo\.ruwangarsip\.id/);
  assert.match(result, /proxy_pass http:\/\/127\.0\.0\.1:7111/);
  assert.match(result, /proxy_pass http:\/\/127\.0\.0\.1:3000/);
  assert.match(result, /location \/api\//);
});

test("log Nginx per domain mencatat korelasi tanpa query, cookie, atau payload", () => {
  const templateSource = fs.readFileSync(DEFAULT_TEMPLATE_PATH, "utf8");
  const result = renderNginxTemplate({ templateSource, ...validValues() });
  assert.match(result, /log_format ruwang_demo\.ruwangarsip\.id escape=json/);
  assert.equal((result.match(/access_log \/var\/log\/nginx\/ruwang-demo\.ruwangarsip\.id-access\.log ruwang_demo\.ruwangarsip\.id;/g) || []).length, 2);
  assert.equal((result.match(/error_log \/var\/log\/nginx\/ruwang-demo\.ruwangarsip\.id-error\.log warn;/g) || []).length, 2);
  const format = result.slice(0, result.indexOf("server {"));
  for (const variable of ["time_iso8601", "msec", "server_name", "request_id", "connection", "request_method", "uri", "status", "upstream_addr", "upstream_status", "upstream_header_time", "upstream_response_time", "upstream_http_x_nextjs_action_not_found"]) {
    assert.ok(format.includes(`$${variable}`));
  }
  assert.doesNotMatch(format, /\$(?:request|request_uri|args|query_string|request_body|http_cookie|http_authorization|http_referer|http_next_action)\b/);
  assert.equal((result.match(/proxy_set_header X-Request-ID \$request_id;/g) || []).length, 2);
  assert.equal((result.match(/proxy_hide_header X-Request-ID;/g) || []).length, 2);
  assert.equal((result.match(/add_header X-Request-ID \$request_id always;/g) || []).length, 2);
});

test("renderer Nginx menolak domain, path, port, dan overwrite yang tidak aman", () => {
  const templateSource = fs.readFileSync(DEFAULT_TEMPLATE_PATH, "utf8");
  assert.throws(
    () => renderNginxTemplate({
      templateSource,
      ...validValues(),
      domain: "demo;include /etc/passwd",
    }),
    /FQDN|label/,
  );
  assert.throws(
    () => renderNginxTemplate({
      templateSource,
      ...validValues(),
      tlsCertificatePath: "/etc/../secret.pem",
    }),
    /path Linux yang aman/,
  );
  assert.throws(
    () => renderNginxTemplate({
      templateSource,
      ...validValues(),
      apiPort: "3000",
    }),
    /wajib berbeda/,
  );

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ruwang-nginx-"));
  try {
    const outputPath = path.join(temporaryDirectory, "demo.conf");
    renderNginxConfigFile({ outputPath, ...validValues() });
    assert.throws(
      () => renderNginxConfigFile({ outputPath, ...validValues() }),
      /tidak boleh ditimpa/,
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("file yang muncul selama render tidak dapat ditimpa", (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ruwang-nginx-race-"));
  const outputPath = path.join(temporaryDirectory, "demo.conf");
  const readFile = fs.readFileSync;
  try {
    context.mock.method(fs, "readFileSync", function (filename, ...options) {
      const source = readFile.call(fs, filename, ...options);
      if (filename === DEFAULT_TEMPLATE_PATH) fs.writeFileSync(outputPath, "existing-config", { flag: "wx" });
      return source;
    });
    assert.throws(() => renderNginxConfigFile({ outputPath, ...validValues() }), /tidak boleh ditimpa/);
    assert.equal(readFile(outputPath, "utf8"), "existing-config");
  } finally {
    context.mock.restoreAll();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
