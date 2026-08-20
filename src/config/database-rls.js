const systemPrisma = require("./prisma-system");
const { baseClient } = require("./prisma-runtime");
const {
  getDatabaseContext,
  requireDatabaseUserId,
  runWithDatabaseContext,
  runWithDatabaseTransactionClient,
} = require("./database-context");
const { getRequestContext } = require("../utils/request-context");

function requireUserId(userId) {
  try {
    return requireDatabaseUserId(userId);
  } catch {
    throw new Error("Konteks RLS membutuhkan user ID UUID yang valid.");
  }
}

async function setRlsContext(client, userId, accessPurpose = "") {
  const normalizedUserId = requireUserId(userId);
  const request = getRequestContext();
  await client.$executeRaw`
    SELECT
      set_config('app.current_user_id', ${normalizedUserId}, true),
      set_config('app.access_purpose', ${String(accessPurpose || "")}, true),
      set_config('app.request_id', ${String(request.request_id || "")}, true),
      set_config('app.request_method', ${String(request.request_method || "")}, true),
      set_config('app.request_path', ${String(request.request_path || "")}, true),
      set_config('app.user_agent', ${String(request.user_agent || "")}, true)
  `;
  await client.$executeRaw`
    SELECT public.ruwang_arsip_prepare_read_context()
  `;
}


async function setRlsUserContext(client, userId) {
  return setRlsContext(client, userId);
}

async function withRlsUserContext(userId, callback) {
  if (typeof callback !== "function") {
    throw new TypeError("Callback konteks RLS wajib berupa fungsi.");
  }

  const normalizedUserId = requireUserId(userId);
  return baseClient.$transaction(async (tx) => {
    await setRlsContext(tx, userId);
    return runWithDatabaseContext(
      { transactionClient: tx, userId: normalizedUserId },
      () => callback(tx),
    );
  });
}

async function withDatabaseTransaction(callback, options) {
  if (typeof callback !== "function") {
    throw new TypeError("Callback transaction database wajib berupa fungsi.");
  }

  const { accessPurpose, userId } = getDatabaseContext();
  return baseClient.$transaction(
    async (tx) => {
      if (userId) await setRlsContext(tx, userId, accessPurpose);
      return runWithDatabaseTransactionClient(tx, () => callback(tx));
    },
    options,
  );
}

async function withSystemDatabaseClient(callback) {
  if (typeof callback !== "function") {
    throw new TypeError("Callback database sistem wajib berupa fungsi.");
  }
  return callback(systemPrisma);
}

module.exports = {
  requireUserId,
  setRlsContext,
  setRlsUserContext,
  withDatabaseTransaction,
  withRlsUserContext,
  withSystemDatabaseClient,
};
