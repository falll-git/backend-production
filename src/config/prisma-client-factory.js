const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const { getDatabaseContext } = require("./database-context");
const {
  buildDatabasePoolConfig,
  buildDatabaseTransactionOptions,
} = require("./database-pool");
const { getRequestContext } = require("../utils/request-context");

function createBasePrismaClient(options = {}) {
  const adapter = new PrismaPg(
    buildDatabasePoolConfig(process.env, {
      ...(options.applicationName
        ? { applicationName: options.applicationName }
        : {}),
      ...(options.connectionString
        ? { connectionString: options.connectionString }
        : {}),
      ...(options.maxKey ? { maxKey: options.maxKey } : {}),
    }),
  );

  return new PrismaClient({
    adapter,
    transactionOptions: buildDatabaseTransactionOptions(process.env),
  });
}

function createRlsQueryHandler(baseClient) {
  return async function applyRlsContext({ args, query }) {
    const { accessPurpose, transactionClient, userId } = getDatabaseContext();
    if (!userId || transactionClient) return query(args);
    const request = getRequestContext();

    const setContext = baseClient.$executeRaw`
      SELECT
        set_config('app.current_user_id', ${userId}, true),
        set_config('app.access_purpose', ${String(accessPurpose || "")}, true),
        set_config('app.request_id', ${String(request.request_id || "")}, true),
        set_config('app.request_method', ${String(request.request_method || "")}, true),
        set_config('app.request_path', ${String(request.request_path || "")}, true),
        set_config('app.user_agent', ${String(request.user_agent || "")}, true)
    `;
    const prepareReadContext = baseClient.$executeRaw`
      SELECT public.ruwang_arsip_prepare_read_context()
    `;
    const [, , result] = await baseClient.$transaction([
      setContext,
      prepareReadContext,
      query(args),
    ]);
    return result;
  };
}

function createContextualPrismaProxy(defaultClient) {
  return new Proxy(defaultClient, {
    get(target, property) {
      const contextualClient =
        getDatabaseContext().transactionClient || target;
      const value = Reflect.get(contextualClient, property, contextualClient);
      return typeof value === "function"
        ? value.bind(contextualClient)
        : value;
    },
  });
}

function createRlsAwarePrismaClient(options = {}) {
  const baseClient = createBasePrismaClient(options);
  const extendedClient = baseClient.$extends({
    name: "ruwang-arsip-request-rls",
    query: {
      $allOperations: createRlsQueryHandler(baseClient),
    },
  });

  return {
    baseClient,
    client: createContextualPrismaProxy(extendedClient),
  };
}

module.exports = {
  createBasePrismaClient,
  createContextualPrismaProxy,
  createRlsAwarePrismaClient,
  createRlsQueryHandler,
};
