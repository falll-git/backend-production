const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TEMPLATE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "ops",
  "nginx",
  "ruwang-domain.conf.example",
);

function assertDomain(value) {
  const domain = String(value || "").trim().toLowerCase();
  if (domain.length > 253 || domain.length < 3 || !domain.includes(".")) {
    throw new Error("Domain Nginx wajib berupa FQDN.");
  }
  const labels = domain.split(".");
  if (
    labels.some(
      (label) =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  ) {
    throw new Error("Domain Nginx mengandung label yang tidak valid.");
  }
  return domain;
}

function assertPort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} wajib berupa port 1-65535.`);
  }
  return String(port);
}

function assertPosixAbsolutePath(value, label) {
  const configured = String(value || "").trim();
  if (
    !configured.startsWith("/") ||
    configured.includes("\\") ||
    configured.split("/").includes("..") ||
    !/^\/[A-Za-z0-9._/-]+$/.test(configured)
  ) {
    throw new Error(`${label} wajib berupa absolute path Linux yang aman.`);
  }
  return configured;
}

function renderNginxTemplate({
  templateSource,
  domain,
  apiPort,
  frontendPort,
  tlsCertificatePath,
  tlsCertificateKeyPath,
} = {}) {
  const source = String(templateSource || "");
  if (!source.trim()) throw new Error("Template Nginx tidak boleh kosong.");
  const replacements = {
    __RUWANG_DOMAIN__: assertDomain(domain),
    __RUWANG_API_PORT__: assertPort(apiPort, "API port"),
    __RUWANG_FRONTEND_PORT__: assertPort(frontendPort, "Frontend port"),
    __TLS_CERTIFICATE_PATH__: assertPosixAbsolutePath(
      tlsCertificatePath,
      "TLS certificate path",
    ),
    __TLS_CERTIFICATE_KEY_PATH__: assertPosixAbsolutePath(
      tlsCertificateKeyPath,
      "TLS certificate key path",
    ),
  };
  if (replacements.__RUWANG_API_PORT__ === replacements.__RUWANG_FRONTEND_PORT__) {
    throw new Error("Port frontend dan API wajib berbeda.");
  }
  let rendered = source;
  for (const [token, replacement] of Object.entries(replacements)) {
    if (!rendered.includes(token)) throw new Error(`Token template hilang: ${token}`);
    rendered = rendered.replaceAll(token, replacement);
  }
  if (/__[A-Z0-9_]+__/.test(rendered)) {
    throw new Error("Template Nginx masih memiliki token yang belum diisi.");
  }
  return rendered;
}

function renderNginxConfigFile({
  templatePath = DEFAULT_TEMPLATE_PATH,
  outputPath,
  ...values
} = {}) {
  const output = String(outputPath || "").trim();
  if (!output || !path.isAbsolute(output)) {
    throw new Error("Output Nginx wajib berupa absolute path.");
  }
  const resolvedOutput = path.resolve(output);
  if (fs.existsSync(resolvedOutput)) {
    throw new Error("Output Nginx sudah ada dan tidak boleh ditimpa.");
  }
  const rendered = renderNginxTemplate({
    templateSource: fs.readFileSync(path.resolve(templatePath), "utf8"),
    ...values,
  });
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, rendered, { encoding: "utf8", mode: 0o644 });
  return { output_path: resolvedOutput, bytes: Buffer.byteLength(rendered) };
}

module.exports = {
  DEFAULT_TEMPLATE_PATH,
  assertDomain,
  assertPort,
  assertPosixAbsolutePath,
  renderNginxConfigFile,
  renderNginxTemplate,
};
