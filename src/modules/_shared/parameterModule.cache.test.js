const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createParameterService,
} = require("./parameterModule.factory");
const {
  createApplicationCache,
  createMemoryCacheStore,
} = require("../../system/application-cache");

function createRepository() {
  let rows = [{ id: "one", code: "ONE", name: "Satu", deleted_at: null }];
  const calls = { count: 0, findMany: 0, findById: 0 };

  return {
    calls,
    remove(id) {
      rows = rows.filter((row) => row.id !== id);
    },
    async count() {
      calls.count += 1;
      return rows.filter((row) => !row.deleted_at).length;
    },
    async findMany() {
      calls.findMany += 1;
      return rows.filter((row) => !row.deleted_at);
    },
    async findById(id) {
      calls.findById += 1;
      return rows.find((row) => row.id === id && !row.deleted_at) || null;
    },
    async create(data) {
      const created = { id: `row-${rows.length + 1}`, deleted_at: null, ...data };
      rows.push(created);
      return created;
    },
    async update(id, data) {
      rows = rows.map((row) => (row.id === id ? { ...row, ...data } : row));
      return rows.find((row) => row.id === id);
    },
  };
}

test("parameter global di-cache, pencarian/page lanjutan dilewati, dan setiap mutasi menginvalidasi", async () => {
  const repository = createRepository();
  const applicationCache = createApplicationCache({
    enabled: true,
    store: createMemoryCacheStore(),
    jitterPercent: 0,
  });
  const service = createParameterService({
    modelName: "test_parameters",
    repository,
    label: "Parameter test",
    cacheNamespace: "parameter:test",
    applicationCache,
  });

  await service.getAll({ page: 1, limit: 10 });
  await service.getAll({ page: 1, limit: 10 });
  assert.equal(repository.calls.findMany, 1);
  assert.equal(repository.calls.count, 1);

  await service.getAll({ page: 1, limit: 10, search: "satu" });
  await service.getAll({ page: 1, limit: 10, search: "satu" });
  await service.getAll({ page: 2, limit: 10 });
  await service.getAll({ page: 2, limit: 10 });
  assert.equal(repository.calls.findMany, 5);

  await service.getById("one");
  await service.getById("one");
  assert.equal(repository.calls.findById, 1);

  await service.create({ code: "TWO", name: "Dua" }, "admin");
  await service.getAll({ page: 1, limit: 10 });
  await service.update("one", { name: "Satu Baru" }, "admin");
  await service.getAll({ page: 1, limit: 10 });
  await service.delete("one", "admin");
  await service.getAll({ page: 1, limit: 10 });

  assert.equal(applicationCache.metrics().invalidation, 3);
  assert.equal(repository.calls.findMany, 8);
});

test("jalur write tidak mempercayai detail lama yang masih berada di cache", async () => {
  const repository = createRepository();
  const applicationCache = createApplicationCache({
    enabled: true,
    store: createMemoryCacheStore(),
  });
  const service = createParameterService({
    modelName: "test_parameters",
    repository,
    label: "Parameter test",
    cacheNamespace: "parameter:test-write",
    applicationCache,
  });

  await service.getById("one");
  repository.remove("one");

  await assert.rejects(
    service.update("one", { name: "Tidak boleh" }, "admin"),
    /tidak ditemukan/,
  );
});
