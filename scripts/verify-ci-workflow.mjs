import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A narrow check of the repository-authored job layouts, not an arbitrary
// YAML/shell security parser. Frontend policy must precede its mutative npm ci.
export function validateFrontendNpmPolicyWorkflow(source, jobId = "release-quality") {
  const text = String(source || "").replace(/^\s*#.*$/gm, "");
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => line === `  ${jobId}:`);
  if (start < 0) throw new Error(`Workflow npm policy wajib memiliki job ${jobId}.`);
  let end = start + 1;
  while (end < lines.length && !/^  [A-Za-z_][A-Za-z0-9_-]*:\s*$/.test(lines[end])) end++;
  const body = lines.slice(start + 1, end).join("\n");
  const steps = body.split(/^      - /m).slice(1).map(block => `      - ${block}`);
  const names = ["Bootstrap pinned npm in ephemeral runner", "Verify frontend package policy", "Install frontend dependencies"];
  const positions = names.map(name => steps.findIndex(step => step.split("\n")[0] === `      - name: ${name}`));
  const selected = positions.map(index => steps[index] || "");
  const errors = [];
  for (const name of names) if (steps.filter(step => step.split("\n")[0] === `      - name: ${name}`).length !== 1) errors.push(`Langkah wajib tepat sekali: ${name}.`);
  const commands = step => {
    const rows = step.split("\n"), run = rows.findIndex(line => /^        run: /.test(line));
    if (run < 0) return [];
    if (rows[run] !== "        run: |") return [rows[run].slice("        run: ".length)];
    const result = [];
    for (const line of rows.slice(run + 1)) {
      if (!line.trim()) continue;
      if (!line.startsWith("          ")) break;
      result.push(line.slice(10));
    }
    return result;
  };
  const expected = [
    ['set -euo pipefail', 'npm install --global npm@11.21.0 --ignore-scripts --no-audit --no-fund', 'test "$(npm --version)" = "11.21.0"'],
    ['node scripts/verify-package-policy.mjs'],
    ['node scripts/verify-dependency-age.mjs', 'npm ci'],
  ];
  if (!(positions[0] >= 0 && positions[0] < positions[1] && positions[1] < positions[2])) errors.push("Bootstrap npm, package policy dan frontend install wajib berurutan.");
  for (let i = 0; i < selected.length; i++) {
    if (JSON.stringify(commands(selected[i])) !== JSON.stringify(expected[i])) errors.push(`Perintah npm policy wajib exact dan fail-closed: ${names[i]}.`);
    if (/^\s+(?:if|continue-on-error):/m.test(selected[i])) errors.push("Langkah npm policy tidak boleh dilewati atau mentoleransi kegagalan.");
  }
  if (!/^        working-directory: \$\{\{ runner\.temp \}\}\s*$/m.test(selected[0]) || !/^        shell: bash\s*$/m.test(selected[0])) errors.push("Bootstrap npm pinned wajib memakai bash di runner.temp.");
  for (const step of selected.slice(1)) if (!/^        working-directory: frontend-production\s*$/m.test(step)) errors.push("Package policy dan install wajib memakai checkout frontend.");
  const prefix = text.split(/^jobs:\s*$/m)[0];
  if (/^    (?:if|continue-on-error):/m.test(body) || /^\s*defaults:\s*$/m.test(prefix + "\n" + body) || /^\s*npm_config_(?:force|engine_strict|min_release_age(?:_exclude)?|before)\s*:/im.test(prefix + "\n" + body)) errors.push("Job npm policy tidak boleh mempunyai skip, defaults tersembunyi atau override env npm.");
  for (const [index, step] of steps.entries()) {
    if (/\bnpm\s+ci\b/.test(step) && index < positions[0]) errors.push("npm ci tidak boleh mendahului bootstrap npm pinned.");
    if (index !== positions[0] && /--(?:force|ignore-scripts|engine-strict|min-release-age(?:-exclude)?|before)\b/i.test(step)) errors.push("Langkah dependency tidak boleh melonggarkan policy npm.");
    if (index !== positions[2] && (/for\s+repo\s+in\s+[^;\n]*\bfrontend-production\b/.test(step) || /\bnpm\s+ci[^\n]*--prefix(?:=|\s+)["']?frontend-production\b/.test(step))) errors.push("Frontend npm ci harus terpisah dari loop dependency peer.");
  }
  if (errors.length) throw new Error(`Workflow frontend npm policy tidak sesuai:\n- ${errors.join("\n- ")}`);
  return { npm_version: "11.21.0", age_check_before_ci: true };
}

const REQUIRED_PATTERNS = Object.freeze([
  [/^name:\s*Quality\s*$/m, "nama workflow Quality"],
  [/^\s*pull_request:\s*$/m, "trigger pull_request"],
  [/^\s*push:\s*$/m, "trigger push"],
  [/^\s*workflow_dispatch:\s*$/m, "trigger manual"],
  [/^permissions:\s*\r?\n\s+contents:\s*read\s*$/m, "permission contents read-only"],
  [/^concurrency:\s*$/m, "pembatasan concurrency"],
  [/^\s+cancel-in-progress:\s*true\s*$/m, "pembatalan run lama"],
  [/^\s+runs-on:\s*ubuntu-24\.04\s*$/m, "GitHub-hosted Ubuntu runner"],
  [/^\s+timeout-minutes:\s*\d+\s*$/m, "timeout job"],
  [/^\s+HOME:\s*\/root\s*$/m, "HOME writable untuk browser container"],
  [/^\s+postgres:\s*$/m, "PostgreSQL service CI"],
  [/postgresql:\/\/postgres:postgres@postgres:5432\/ruwang_arsip_ci\?schema=public/, "database PostgreSQL service khusus CI"],
  [/^\s+persist-credentials:\s*false\s*$/m, "checkout tanpa menyimpan credential Git"],
  [/npm run prisma:generate/, "Prisma Client generation"],
  [/npm run ci:provision-runtime-role/, "provisioning runtime role khusus CI"],
  [/npm run quality:release/, "quality gate release"],
  [/^\s+if:\s*\$\{\{\s*failure\(\)\s*\}\}\s*$/m, "artefak hanya saat gagal"],
  [/^\s+retention-days:\s*\d+\s*$/m, "retensi artefak terbatas"],
]);

const FORBIDDEN_PATTERNS = Object.freeze([
  [/^\s*runs-on:\s*.*self-hosted/im, "self-hosted runner"],
  [/^\s*environment:\s*/im, "GitHub deployment environment"],
  [/^\s+[A-Za-z][A-Za-z0-9_-]*:\s*write\s*$/im, "permission write"],
  [/\b(?:pull_request_target|workflow_run|repository_dispatch)\s*:/i, "deployment-style trigger"],
  [/\b(?:ssh|scp|rsync|systemctl|pm2|nginx|kubectl|helm)\b/i, "perintah administrasi/deployment"],
  [/(?:appleboy\/|webfactory\/ssh-agent|docker\s+context|git\s+pull)/i, "action atau perintah deployment"],
  [/curl[^\n]*(?:webhook|deploy)/i, "deployment webhook"],
  [/\bsecrets\.[A-Z0-9_]+/i, "secret repository pada quality workflow"],
]);

export function validateQualityWorkflow(source) {
  const text = String(source || "");
  const errors = [];

  validateFrontendNpmPolicyWorkflow(text);

  for (const [pattern, label] of REQUIRED_PATTERNS) {
    if (!pattern.test(text)) errors.push(`Tidak ditemukan: ${label}.`);
  }

  const checkoutCount = (
    text.match(/uses:\s*actions\/checkout@[0-9a-f]{40}/gi) || []
  ).length;
  if (checkoutCount < 2) {
    errors.push("Workflow wajib checkout frontend dan backend dengan action terpin.");
  }

  const detachedCheckoutCount = (
    text.match(/^\s+persist-credentials:\s*false\s*$/gim) || []
  ).length;
  if (detachedCheckoutCount < checkoutCount) {
    errors.push("Setiap checkout wajib memakai persist-credentials: false.");
  }

  const prismaGenerateIndex = text.indexOf("npm run prisma:generate");
  const provisionRoleIndex = text.indexOf("npm run ci:provision-runtime-role");
  const migrateIndex = text.indexOf("npm run migrate:deploy");
  const seedIndex = text.indexOf("npm run seed");
  if (prismaGenerateIndex < 0 || seedIndex < 0 || prismaGenerateIndex > seedIndex) {
    errors.push("Prisma Client wajib dibuat sebelum database CI di-seed.");
  }
  if (
    provisionRoleIndex < 0 ||
    migrateIndex < 0 ||
    provisionRoleIndex > migrateIndex
  ) {
    errors.push(
      "Runtime role CI wajib diprovisikan sebelum migration database dijalankan.",
    );
  }

  const unpinnedActions = text
    .split(/\r?\n/)
    .filter((line) => /\buses:\s*[^\s]+@/i.test(line))
    .filter((line) => !/@[0-9a-f]{40}(?:\s|$)/i.test(line));
  if (unpinnedActions.length > 0) {
    errors.push("Semua GitHub Action wajib dipin ke commit SHA 40 karakter.");
  }

  if (!/image:\s*postgres:[^\s]+@sha256:[0-9a-f]{64}/i.test(text)) {
    errors.push("Image PostgreSQL CI wajib dipin ke digest SHA-256.");
  }
  if (
    !/image:\s*mcr\.microsoft\.com\/playwright:v1\.61\.1-noble@sha256:[0-9a-f]{64}/i.test(
      text,
    )
  ) {
    errors.push("Image Playwright CI wajib cocok dengan lockfile dan dipin ke digest SHA-256.");
  }

  for (const [pattern, label] of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) errors.push(`Dilarang pada CI quality-only: ${label}.`);
  }

  if (errors.length > 0) {
    throw new Error(`Workflow Quality tidak aman:\n- ${errors.join("\n- ")}`);
  }

  return { checkout_count: checkoutCount, deployment_capability: false };
}

export function verifyQualityWorkflow(
  workflowPath = path.resolve(".github", "workflows", "quality.yml"),
) {
  const result = validateQualityWorkflow(fs.readFileSync(workflowPath, "utf8"));
  console.log(
    JSON.stringify({
      status: "passed",
      workflow: path.relative(process.cwd(), workflowPath),
      ...result,
    }),
  );
  return result;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  verifyQualityWorkflow();
}
