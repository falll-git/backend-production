const assert = require("node:assert/strict");
const test = require("node:test");

const {
  fixtureRecordCounts,
  hasFixtureRecords,
} = require("./persuratan-notification-e2e-fixture");

function records(overrides = {}) {
  return {
    divisionIds: [],
    dispositionIds: [],
    memorandumIds: [],
    recipientIds: [],
    storedPaths: [],
    ...overrides,
  };
}

test("fixture notifikasi membedakan database bersih dari record stale", () => {
  const clean = records();
  const stale = records({ memorandumIds: ["memo-stale"] });

  assert.equal(hasFixtureRecords(clean), false);
  assert.equal(hasFixtureRecords(stale), true);
  assert.deepEqual(fixtureRecordCounts(stale), {
    divisions: 0,
    dispositions: 0,
    memorandums: 1,
    recipients: 0,
  });
});
