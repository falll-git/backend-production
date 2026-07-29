const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const IMPORT_HISTORY_TABLES = new Set([
  "debtor_import_jobs",
  "debtor_import_segments",
  "debtor_slik_records",
  "debtor_external_records",
  "debtor_ideb_uploads",
  "debtor_ideb_upload_files",
]);

function quoteIdentifier(value) {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error("Identifier database tidak valid.");
  return `"${value}"`;
}

function parseBucketDays(value = process.env.RETENTION_REPORT_BUCKET_DAYS) {
  const parsed = String(value || "30,90,180,365")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
  return [...new Set(parsed)].sort((a, b) => a - b);
}

function buildRetentionDefinitions(columns) {
  const byTable = new Map();
  for (const column of columns) {
    if (!byTable.has(column.table_name)) byTable.set(column.table_name, new Set());
    byTable.get(column.table_name).add(column.column_name);
  }
  const definitions = [];
  for (const [tableName, tableColumns] of byTable) {
    if (tableName.endsWith("activity_logs") && tableColumns.has("created_at")) {
      definitions.push({ category: "activity_log", table: tableName, timestamp: "created_at", filter: null });
    }
    if (tableName === "notifications" && tableColumns.has("created_at")) {
      definitions.push({ category: "notification", table: tableName, timestamp: "created_at", filter: null });
    }
    if (IMPORT_HISTORY_TABLES.has(tableName) && tableColumns.has("created_at")) {
      definitions.push({ category: "import_history", table: tableName, timestamp: "created_at", filter: null });
    }
    if (tableColumns.has("deleted_at")) {
      definitions.push({ category: "soft_delete", table: tableName, timestamp: "deleted_at", filter: "deleted_at IS NOT NULL" });
    }
  }
  return definitions.sort((a, b) =>
    `${a.category}:${a.table}`.localeCompare(`${b.category}:${b.table}`),
  );
}

async function getRetentionMetadata(prismaClient) {
  return prismaClient.$queryRawUnsafe(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('created_at', 'deleted_at')
    ORDER BY table_name, ordinal_position
  `);
}

async function inspectRetentionDefinition(prismaClient, definition, bucketDays) {
  const table = quoteIdentifier(definition.table);
  const timestamp = quoteIdentifier(definition.timestamp);
  const where = definition.filter ? `WHERE ${definition.filter}` : "";
  const bucketExpressions = bucketDays
    .map((days, index) =>
      `COUNT(*) FILTER (WHERE ${timestamp} <= $1::timestamptz - ($${index + 2}::int * INTERVAL '1 day'))::bigint AS bucket_${index}`,
    )
    .join(",\n");
  const rows = await prismaClient.$queryRawUnsafe(
    `
      SELECT COUNT(*)::bigint AS total${bucketExpressions ? `,\n${bucketExpressions}` : ""}
      FROM ${table}
      ${where}
    `,
    new Date(),
    ...bucketDays,
  );
  const row = rows[0] || {};
  return {
    category: definition.category,
    table: definition.table,
    timestamp_column: definition.timestamp,
    total: Number(row.total || 0),
    older_than_days: Object.fromEntries(
      bucketDays.map((days, index) => [String(days), Number(row[`bucket_${index}`] || 0)]),
    ),
  };
}

async function buildRetentionReport(prismaClient, {
  bucketDays = parseBucketDays(),
} = {}) {
  const metadata = await getRetentionMetadata(prismaClient);
  const definitions = buildRetentionDefinitions(metadata);
  const datasets = [];
  for (const definition of definitions) {
    datasets.push(await inspectRetentionDefinition(prismaClient, definition, bucketDays));
  }
  return {
    generated_at: new Date().toISOString(),
    dry_run: true,
    deletion_enabled: false,
    policy_status: "awaiting_business_retention_policy",
    bucket_days: bucketDays,
    datasets,
  };
}

module.exports = {
  IMPORT_HISTORY_TABLES,
  buildRetentionDefinitions,
  buildRetentionReport,
  getRetentionMetadata,
  inspectRetentionDefinition,
  parseBucketDays,
};
