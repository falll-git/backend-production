const {
  evaluateDatabaseSecurity,
  inspectDatabaseSecurity,
  safeDatabaseSecuritySummary,
} = require("./database-security");

function readPositiveInt(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function toNumber(value) {
  if (typeof value === "bigint") {
    return Number(value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeNumericFields(record) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === "bigint" || typeof value === "number" ? toNumber(value) : value,
    ]),
  );
}

async function inspectDatabaseHealth(prismaClient, {
  slowQueryThresholdMs = readPositiveInt("DB_SLOW_QUERY_THRESHOLD_MS", 1000),
} = {}) {
  const [summaryRows, securityReport] = await Promise.all([
    prismaClient.$queryRawUnsafe(`
      SELECT
        (SELECT COUNT(*)::bigint FROM pg_index WHERE NOT indisvalid OR NOT indisready) AS invalid_indexes,
        (SELECT COALESCE(SUM(n_dead_tup), 0)::bigint FROM pg_stat_user_tables) AS estimated_dead_tuples,
        (SELECT COUNT(*)::bigint
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND state = 'idle in transaction') AS idle_in_transaction,
        (SELECT COUNT(*)::bigint
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND state <> 'idle'
            AND query_start IS NOT NULL
            AND EXTRACT(EPOCH FROM (clock_timestamp() - query_start)) * 1000 >= $1) AS active_slow_queries
    `, slowQueryThresholdMs),
    inspectDatabaseSecurity(prismaClient),
  ]);
  const [summary] = summaryRows;
  const securityEvaluation = evaluateDatabaseSecurity(securityReport);
  return {
    invalid_indexes: toNumber(summary.invalid_indexes),
    estimated_dead_tuples: toNumber(summary.estimated_dead_tuples),
    idle_in_transaction: toNumber(summary.idle_in_transaction),
    active_slow_queries: toNumber(summary.active_slow_queries),
    slow_query_threshold_ms: slowQueryThresholdMs,
    security: safeDatabaseSecuritySummary(
      securityReport,
      securityEvaluation,
    ),
  };
}

async function getInvalidIndexes(prismaClient) {
  return prismaClient.$queryRawUnsafe(`
    SELECT
      table_rel.relname AS table_name,
      index_rel.relname AS index_name,
      index_data.indisvalid AS is_valid,
      index_data.indisready AS is_ready
    FROM pg_index index_data
    JOIN pg_class index_rel ON index_rel.oid = index_data.indexrelid
    JOIN pg_class table_rel ON table_rel.oid = index_data.indrelid
    JOIN pg_namespace namespace_data ON namespace_data.oid = table_rel.relnamespace
    WHERE namespace_data.nspname = 'public'
      AND (NOT index_data.indisvalid OR NOT index_data.indisready)
    ORDER BY table_rel.relname, index_rel.relname
  `);
}

async function getUnindexedForeignKeys(prismaClient) {
  return prismaClient.$queryRawUnsafe(`
    SELECT
      relation.relname AS table_name,
      constraint_data.conname AS constraint_name,
      array_to_string(ARRAY(
        SELECT attribute.attname
        FROM unnest(constraint_data.conkey) WITH ORDINALITY key_data(attnum, position)
        JOIN pg_attribute attribute
          ON attribute.attrelid = constraint_data.conrelid
         AND attribute.attnum = key_data.attnum
        ORDER BY key_data.position
      ), ',') AS columns
    FROM pg_constraint constraint_data
    JOIN pg_class relation ON relation.oid = constraint_data.conrelid
    JOIN pg_namespace namespace_data ON namespace_data.oid = relation.relnamespace
    WHERE constraint_data.contype = 'f'
      AND namespace_data.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index index_data
        WHERE index_data.indrelid = constraint_data.conrelid
          AND index_data.indisvalid
          AND index_data.indisready
          AND (
            SELECT array_agg(index_key.attnum::smallint ORDER BY index_key.position)
            FROM unnest(index_data.indkey) WITH ORDINALITY index_key(attnum, position)
            WHERE index_key.position <= cardinality(constraint_data.conkey)
          ) = constraint_data.conkey
      )
    ORDER BY relation.relname, constraint_data.conname
  `);
}

async function getTableStatistics(prismaClient, limit) {
  const rows = await prismaClient.$queryRawUnsafe(
    `
      SELECT
        stats.relname AS table_name,
        stats.n_live_tup::bigint AS estimated_live_rows,
        stats.n_dead_tup::bigint AS estimated_dead_rows,
        stats.last_analyze,
        stats.last_autoanalyze,
        stats.last_vacuum,
        stats.last_autovacuum,
        pg_total_relation_size(stats.relid)::bigint AS total_bytes,
        pg_relation_size(stats.relid)::bigint AS table_bytes,
        pg_indexes_size(stats.relid)::bigint AS indexes_bytes
      FROM pg_stat_user_tables stats
      ORDER BY pg_total_relation_size(stats.relid) DESC, stats.relname
      LIMIT $1
    `,
    limit,
  );
  return rows.map(normalizeNumericFields);
}

async function getIndexStatistics(prismaClient, limit) {
  const rows = await prismaClient.$queryRawUnsafe(
    `
      SELECT
        stats.relname AS table_name,
        stats.indexrelname AS index_name,
        stats.idx_scan::bigint AS scans,
        stats.idx_tup_read::bigint AS tuples_read,
        stats.idx_tup_fetch::bigint AS tuples_fetched,
        pg_relation_size(stats.indexrelid)::bigint AS size_bytes
      FROM pg_stat_user_indexes stats
      ORDER BY pg_relation_size(stats.indexrelid) DESC, stats.relname, stats.indexrelname
      LIMIT $1
    `,
    limit,
  );
  return rows.map(normalizeNumericFields);
}

async function getSlowQueryStatistics(prismaClient, limit, thresholdMs) {
  const [extension] = await prismaClient.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
    ) AS available
  `);
  if (!extension?.available) {
    return {
      available: false,
      reason: "pg_stat_statements_not_installed",
      queries: [],
    };
  }

  const rows = await prismaClient.$queryRawUnsafe(
    `
      SELECT
        queryid::text AS query_id,
        calls::bigint AS calls,
        total_exec_time::double precision AS total_exec_time_ms,
        mean_exec_time::double precision AS mean_exec_time_ms,
        rows::bigint AS rows_processed
      FROM pg_stat_statements
      WHERE mean_exec_time >= $1
      ORDER BY mean_exec_time DESC
      LIMIT $2
    `,
    thresholdMs,
    limit,
  );
  return {
    available: true,
    queries: rows.map(normalizeNumericFields),
  };
}

async function buildDatabaseMaintenanceReport(prismaClient, {
  limit = readPositiveInt("DB_MAINTENANCE_REPORT_LIMIT", 50),
  slowQueryThresholdMs = readPositiveInt("DB_SLOW_QUERY_THRESHOLD_MS", 1000),
} = {}) {
  const [
    health,
    invalidIndexes,
    unindexedForeignKeys,
    tables,
    indexes,
    slowQueries,
  ] = await Promise.all([
    inspectDatabaseHealth(prismaClient, { slowQueryThresholdMs }),
    getInvalidIndexes(prismaClient),
    getUnindexedForeignKeys(prismaClient),
    getTableStatistics(prismaClient, limit),
    getIndexStatistics(prismaClient, limit),
    getSlowQueryStatistics(prismaClient, limit, slowQueryThresholdMs),
  ]);
  return {
    generated_at: new Date().toISOString(),
    read_only: true,
    health,
    invalid_indexes: invalidIndexes,
    unindexed_foreign_keys: unindexedForeignKeys,
    table_statistics: tables,
    index_statistics: indexes,
    slow_query_statistics: slowQueries,
    automatic_vacuum_full: false,
  };
}

module.exports = {
  buildDatabaseMaintenanceReport,
  getIndexStatistics,
  getInvalidIndexes,
  getUnindexedForeignKeys,
  getSlowQueryStatistics,
  getTableStatistics,
  inspectDatabaseHealth,
  normalizeNumericFields,
};
