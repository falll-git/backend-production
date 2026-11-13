import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { validateQualityWorkflow, validateFrontendNpmPolicyWorkflow } from "./verify-ci-workflow.mjs";

const workflow = fs.readFileSync(
  path.resolve(".github", "workflows", "quality.yml"),
  "utf8",
).replaceAll("\r\n", "\n");

test("workflow Quality memenuhi kebijakan CI quality-only", () => {
  assert.deepEqual(validateQualityWorkflow(workflow), {
    checkout_count: 3,
    deployment_capability: false,
  });
});

test("workflow Quality menolak permission write", () => {
  assert.throws(
    () => validateQualityWorkflow(workflow.replace("contents: read", "contents: write")),
    /permission write/,
  );
});

test("Quality mewajibkan Control peer beserta dependency runtime bagi pure backend tests", () => {
  for (const changed of [
    workflow.replace("repository: falll-git/ruwang-control", "repository: falll-git/different-peer"),
    workflow.replace("path: ruwang-control", "path: misplaced-control"),
    workflow.replace("run: npm ci --omit=dev", "run: echo no-control-dependencies"),
    workflow.replace("      - name: Install Control domain peer dependencies", "      - name: Install Control domain peer dependencies\n        if: false"),
  ]) {
    assert.throws(() => validateQualityWorkflow(changed), /Pure backend tests/);
  }
});

test("workflow Quality menolak permission write pada scope lain", () => {
  assert.throws(
    () => validateQualityWorkflow(`${workflow}\n    permissions:\n      issues: write\n`),
    /permission write/,
  );
});

test("workflow Quality mewajibkan semua checkout memutus credential Git", () => {
  assert.throws(
    () =>
      validateQualityWorkflow(
        workflow.replace(/\n\s+persist-credentials:\s*false/, ""),
      ),
    /Setiap checkout/,
  );
});

test("workflow Quality mewajibkan Prisma Client dibuat sebelum seed", () => {
  assert.throws(
    () =>
      validateQualityWorkflow(
        workflow.replace(/\n\s+- name: Generate Prisma client[\s\S]*?run: npm run prisma:generate\n/, "\n"),
      ),
    /Prisma Client/,
  );
});

test("workflow Quality mewajibkan runtime role CI sebelum migration", () => {
  assert.throws(
    () =>
      validateQualityWorkflow(
        workflow.replace(
          /\n\s+- name: Provision least-privilege runtime role for CI migrations[\s\S]*?run: npm run ci:provision-runtime-role\n/,
          "\n",
        ),
      ),
    /provisioning runtime role|Runtime role CI/i,
  );
});

test("workflow Quality mewajibkan HOME writable untuk browser container", () => {
  assert.throws(
    () => validateQualityWorkflow(workflow.replace(/^\s+HOME:\s*\/root\s*\r?\n/m, "")),
    /HOME writable/,
  );
});

test("workflow Quality menolak pull_request_target", () => {
  assert.throws(
    () => validateQualityWorkflow(`${workflow}\npull_request_target:\n`),
    /deployment-style trigger/,
  );
});

test("workflow Quality menolak SSH ke server", () => {
  assert.throws(
    () => validateQualityWorkflow(`${workflow}\n      - run: ssh production-vps\n`),
    /administrasi\/deployment/,
  );
});

test("workflow Quality menolak action yang tidak dipin", () => {
  assert.throws(
    () =>
      validateQualityWorkflow(
        workflow.replace(
          /actions\/checkout@[0-9a-f]{40}/,
          "actions/checkout@v6",
        ),
      ),
    /commit SHA 40 karakter/,
  );
});

test("frontend dependency policy pins native npm before package policy and lock-age before ci", () => {
  assert.deepEqual(validateFrontendNpmPolicyWorkflow(workflow), { npm_version: "11.21.0", age_check_before_ci: true });
});

test("frontend dependency policy rejects missing bootstrap, wrong npm, or missing version assertion", () => {
  for (const changed of [workflow.replace(/\n      - name: Bootstrap pinned npm in ephemeral runner[\s\S]*?(?=\n      - name:)/, ""), workflow.replace("npm@11.21.0", "npm@11.8.0"), workflow.replace('          test "$(npm --version)" = "11.21.0"\n', "")]) assert.throws(() => validateFrontendNpmPolicyWorkflow(changed), /npm policy|Bootstrap/);
});

test("frontend dependency policy rejects absent, late or tolerated age verification", () => {
  for (const changed of [workflow.replace("          node scripts/verify-dependency-age.mjs\n", ""), workflow.replace("          node scripts/verify-dependency-age.mjs\n          npm ci", "          npm ci\n          node scripts/verify-dependency-age.mjs"), workflow.replace("node scripts/verify-dependency-age.mjs", "node scripts/verify-dependency-age.mjs || true"), workflow.replace("      - name: Install frontend dependencies", "      - name: Install frontend dependencies\n        continue-on-error: true")]) assert.throws(() => validateFrontendNpmPolicyWorkflow(changed), /npm policy/);
});

test("frontend dependency policy rejects missing package policy or wrong working directory", () => {
  const policy = "      - name: Verify frontend package policy\n        working-directory: frontend-production\n        run: node scripts/verify-package-policy.mjs";
  for (const changed of [workflow.replace(policy, ""), workflow.replace(policy, policy.replace("working-directory: frontend-production", "working-directory: backend-production"))]) assert.throws(() => validateFrontendNpmPolicyWorkflow(changed), /npm policy/);
});

test("frontend dependency policy rejects early ci, hidden defaults and policy overrides", () => {
  for (const changed of [workflow.replace("    steps:\n", "    steps:\n      - run: npm ci\n"), workflow.replace("    steps:\n", "    defaults:\n      run:\n        working-directory: backend-production\n    steps:\n"), workflow.replace('      CI: "true"', '      CI: "true"\n      NPM_CONFIG_MIN_RELEASE_AGE: "0"'), workflow.replace("          npm ci\n", "          npm ci --ignore-scripts\n")]) assert.throws(() => validateFrontendNpmPolicyWorkflow(changed), /npm policy/);
});
