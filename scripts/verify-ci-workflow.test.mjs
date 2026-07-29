import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { validateQualityWorkflow } from "./verify-ci-workflow.mjs";

const workflow = fs.readFileSync(
  path.resolve(".github", "workflows", "quality.yml"),
  "utf8",
);

test("workflow Quality memenuhi kebijakan CI quality-only", () => {
  assert.deepEqual(validateQualityWorkflow(workflow), {
    checkout_count: 2,
    deployment_capability: false,
  });
});

test("workflow Quality menolak permission write", () => {
  assert.throws(
    () => validateQualityWorkflow(workflow.replace("contents: read", "contents: write")),
    /permission write/,
  );
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
