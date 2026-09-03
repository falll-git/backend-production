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
