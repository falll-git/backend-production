import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  [/^\s+postgres:\s*$/m, "PostgreSQL service CI"],
  [/postgresql:\/\/postgres:postgres@postgres:5432\/ruwang_arsip_ci\?schema=public/, "database PostgreSQL service khusus CI"],
  [/^\s+persist-credentials:\s*false\s*$/m, "checkout tanpa menyimpan credential Git"],
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
