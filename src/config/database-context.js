const { AsyncLocalStorage } = require("node:async_hooks");

const databaseContextStorage = new AsyncLocalStorage();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATABASE_ACCESS_PURPOSES = Object.freeze([
  "digital_document_requestable",
]);

function requireDatabaseUserId(userId) {
  const normalized = String(userId || "").trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error("Konteks database membutuhkan user ID UUID yang valid.");
  }
  return normalized;
}

function getDatabaseContext() {
  return databaseContextStorage.getStore() || {};
}

function requireDatabaseAccessPurpose(purpose) {
  const normalized = String(purpose || "").trim();
  if (!DATABASE_ACCESS_PURPOSES.includes(normalized)) {
    throw new Error("Tujuan akses database tidak dikenal.");
  }
  return normalized;
}

function runWithDatabaseContext(context, callback) {
  if (typeof callback !== "function") {
    throw new TypeError("Callback konteks database wajib berupa fungsi.");
  }

  return databaseContextStorage.run(
    {
      ...getDatabaseContext(),
      ...(context || {}),
    },
    callback,
  );
}

function runWithDatabaseUserContext(userId, callback) {
  return runWithDatabaseContext(
    { userId: requireDatabaseUserId(userId) },
    callback,
  );
}

function runWithDatabaseAccessPurpose(purpose, callback) {
  return runWithDatabaseContext(
    { accessPurpose: requireDatabaseAccessPurpose(purpose) },
    callback,
  );
}

function runWithDatabaseTransactionClient(transactionClient, callback) {
  if (!transactionClient || typeof transactionClient !== "object") {
    throw new TypeError("Transaction client konteks database wajib tersedia.");
  }
  return runWithDatabaseContext({ transactionClient }, callback);
}

module.exports = {
  DATABASE_ACCESS_PURPOSES,
  getDatabaseContext,
  requireDatabaseAccessPurpose,
  requireDatabaseUserId,
  runWithDatabaseAccessPurpose,
  runWithDatabaseContext,
  runWithDatabaseTransactionClient,
  runWithDatabaseUserContext,
};
