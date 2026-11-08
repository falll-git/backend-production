const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Pure module tests: never import runtime clients, load .env, or connect to a DB.
const root = path.resolve(__dirname, "..");
const clone = (value) => JSON.parse(JSON.stringify(value));
function load(relative, dependencies = {}) {
  const filename = path.join(root, relative), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, exports: module.exports, __dirname: path.dirname(filename),
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (["path", "fs/promises"].includes(name)) return require(name);
      return {};
    },
  }, { filename });
  return module.exports;
}
class AppError extends Error {
  constructor(message, statusCode) { super(message); this.statusCode = statusCode; }
}

function fixture(kind, options = {}) {
  const contract = kind === "contract", calls = [];
  const initial = {
    id: "record-1", debtor_id: "debtor-1", created_by: "actor-1",
    name: "Synthetic debtor", no_kontrak: "SYNTHETIC-1", status: "ACTIVE",
    updated_at: new Date("2026-01-01T00:00:00Z"), deleted_at: null,
  };
  let stored = clone(initial), audits = [], committed = false;
  const tx = { debtor_activity_logs: { async create({ data }) {
    calls.push("audit");
    if (options.auditError) throw options.auditError;
    assert.equal(stored.status, "INACTIVE");
    audits.push(clone(data));
    return { id: "audit-1", ...data };
  } } };
  const repository = {
    async transaction(callback) {
      calls.push("transaction");
      const prior = clone(stored), priorAudits = clone(audits);
      try { const value = await callback(tx); committed = true; return value; }
      catch (error) { stored = prior; audits = priorAudits; throw error; }
    },
    async findById(id, where, db) {
      calls.push("authorized-read");
      assert.equal(id, initial.id); assert.equal(db, tx);
      assert.equal(where.deleted_at, null);
      assert.equal(calls.filter((c) => c === "authorized-read").length, 1);
      if (options.missing) return null;
      return { ...initial, created_by: options.forbidden ? "someone-else" : "actor-1" };
    },
    async softDelete(current, changes, db) {
      calls.push("counted-update"); assert.equal(db, tx);
      assert.equal(current.id, initial.id);
      assert.deepEqual(Object.keys(changes).sort(), ["deleted_at", "deleted_by", "status"]);
      if (options.updateError) throw options.updateError;
      const count = options.count ?? 1;
      if (count === 1) stored = clone({ ...current, ...changes });
      return { count };
    },
    async update() { throw new Error("hidden-row RETURNING must not be used"); },
  };
  const audit = load("utils/debtor-audit-log.js", { "../config/prisma": {}, "../system/logger": {} });
  const access = {
    getDebtorAccessScope: async () => ({ userId: "actor-1", canManageAll: false }),
    buildDebtorManageWhere: () => ({ created_by: "actor-1" }),
    buildContractVisibilityWhere: () => ({ created_by: "actor-1" }),
  };
  const service = load(contract ? "modules/debtor-contracts/debtorContracts.service.js" : "modules/debtors/debtors.service.js", {
    [contract ? "./debtorContracts.repository" : "./debtors.repository"]: repository,
    "../../utils/errors": { AppError }, "../../utils/debtor-access": access,
    "../../utils/debtor-audit-log": audit,
  });
  return { service, calls, initial, get stored() { return stored; }, get audits() { return audits; }, get committed() { return committed; } };
}

for (const kind of ["contract", "debtor"]) {
  test(`${kind} delete: counted update and exact before/after audit share one transaction`, async () => {
    const f = fixture(kind);
    assert.equal(await f.service.delete({ id: f.initial.id, userId: "actor-1" }), undefined);
    assert.deepEqual(f.calls, ["transaction", "authorized-read", "counted-update", "audit"]);
    assert.equal(f.committed, true); assert.equal(f.audits.length, 1);
    const audit = f.audits[0];
    assert.equal(audit.entity_type, kind === "contract" ? "debtor_contracts" : "digital_debtors");
    assert.equal(audit.entity_id, f.initial.id); assert.equal(audit.actor_id, "actor-1");
    assert.equal(audit.debtor_id, kind === "contract" ? f.initial.debtor_id : f.initial.id);
    assert.equal(audit.action, "DELETE"); assert.equal(audit.source, "MANUAL");
    assert.equal(audit.before_data.status, "ACTIVE"); assert.equal(audit.before_data.deleted_at, null);
    assert.equal(audit.after_data.status, "INACTIVE"); assert.equal(audit.after_data.deleted_by, "actor-1");
    assert.equal(audit.after_data.deleted_at, f.stored.deleted_at);
    assert.equal(audit.after_data.id, audit.before_data.id);
  });
  for (const [condition, status] of [["missing", 404], ["forbidden", 403]]) {
    test(`${kind} delete: ${condition} still denies before mutation/audit`, async () => {
      const f = fixture(kind, { [condition]: true });
      await assert.rejects(f.service.delete({ id: f.initial.id, userId: "actor-1" }), (e) => e.statusCode === status);
      assert.deepEqual(f.calls, ["transaction", "authorized-read"]);
      assert.equal(f.committed, false); assert.equal(f.audits.length, 0); assert.equal(f.stored.status, "ACTIVE");
    });
  }
  for (const count of [0, 2]) {
    test(`${kind} delete: affected count ${count} refuses, no false audit`, async () => {
      const f = fixture(kind, { count });
      await assert.rejects(f.service.delete({ id: f.initial.id, userId: "actor-1" }), (e) => e.statusCode === 409);
      assert.equal(f.committed, false); assert.equal(f.audits.length, 0); assert.equal(f.stored.status, "ACTIVE");
      assert(!f.calls.includes("audit"));
    });
  }
  for (const boundary of ["update", "audit"]) {
    test(`${kind} delete: ${boundary} failure propagates and rolls back`, async () => {
      const error = new Error(`synthetic ${boundary} failure`), f = fixture(kind, { [boundary + "Error"]: error });
      await assert.rejects(f.service.delete({ id: f.initial.id, userId: "actor-1" }), (e) => e === error);
      assert.equal(f.committed, false); assert.equal(f.audits.length, 0); assert.equal(f.stored.status, "ACTIVE");
    });
  }
  test(`${kind} repository: updateMany bounds id/active/version and returns only count`, async () => {
    const model = kind === "contract" ? "debtor_contracts" : "digital_debtors";
    const current = { id: "record-1", updated_at: new Date("2026-01-01T00:00:00Z") };
    const data = { status: "INACTIVE", deleted_by: "actor-1", deleted_at: new Date() };
    let actual;
    const tx = { [model]: { updateMany(args) { actual = args; return Promise.resolve({ count: 1 }); } } };
    const repo = load(kind === "contract" ? "modules/debtor-contracts/debtorContracts.repository.js" : "modules/debtors/debtors.repository.js");
    assert.equal((await repo.softDelete(current, data, tx)).count, 1);
    assert.deepEqual(clone(actual), clone({ where: { id: current.id, deleted_at: null, updated_at: current.updated_at }, data }));
    assert(!Object.hasOwn(actual, "select")); assert(!Object.hasOwn(actual, "include"));
  });
}

test("strict debtor audit export propagates failure instead of safe suppression", async () => {
  const audit = load("utils/debtor-audit-log.js"), failure = new Error("synthetic audit rejection");
  await assert.rejects(audit.recordDebtorActivity({ debtor_activity_logs: { create: async () => { throw failure; } } }, { action: "DELETE", entity_type: "digital_debtors" }), (e) => e === failure);
});

test("additive migration changes only three expressions and retains RLS/helpers/identity checks", () => {
  const sql = fs.readFileSync(path.join(root, "../prisma/migrations/20261020090000_fix_debtor_create_returning_rls/migration.sql"), "utf8");
  const executable = sql.replace(/--[^\n]*/g, "");
  assert.equal((executable.match(/ALTER POLICY/g) || []).length, 3);
  assert.equal((executable.match(/created_by = public\.ruwang_arsip_current_user_id\(\)/g) || []).length, 2);
  assert.equal((executable.match(/ruwang_arsip_debtor_read_scope_mode\(\) > 0/g) || []).length, 2);
  assert.match(executable, /OR public\.ruwang_arsip_can_read_debtor\(id\)/);
  assert.match(executable, /OR public\.ruwang_arsip_can_read_contract\(id\)/);
  assert.match(executable, /can_manage_debtor\(debtor_id\)\s+AND public\.ruwang_arsip_can_read_contract\(id\)/);
  assert.doesNotMatch(executable, /\b(?:GRANT|REVOKE|DROP|DISABLE|BYPASSRLS|FUNCTION|ROLE)\b/i);
});
