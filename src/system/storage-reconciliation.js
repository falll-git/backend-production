const crypto = require("crypto");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const {
  PUBLIC_PREFIX: DIGITAL_ARCHIVE_PREFIX,
  STORAGE_ROOT: DIGITAL_ARCHIVE_ROOT,
} = require("../utils/digital-archive-files");
const {
  PUBLIC_PREFIX: PERSURATAN_PREFIX,
  STORAGE_ROOT: PERSURATAN_ROOT,
} = require("../utils/persuratan-files");
const {
  PUBLIC_PREFIX: WATERMARK_PREFIX,
  STORAGE_ROOT: WATERMARK_ROOT,
} = require("../utils/watermark-files");
const {
  PUBLIC_PREFIX: WATERMARKED_PREFIX,
  STORAGE_ROOT: WATERMARKED_ROOT,
} = require("../utils/watermarked-files");

const STORAGE_MOUNTS = [
  { key: "digital_archive", prefix: DIGITAL_ARCHIVE_PREFIX, root: DIGITAL_ARCHIVE_ROOT },
  { key: "persuratan", prefix: PERSURATAN_PREFIX, root: PERSURATAN_ROOT },
  { key: "watermark_assets", prefix: WATERMARK_PREFIX, root: WATERMARK_ROOT },
  { key: "watermarked_files", prefix: WATERMARKED_PREFIX, root: WATERMARKED_ROOT },
];
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function quoteIdentifier(value) {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error("Identifier database tidak valid.");
  }
  return `"${value}"`;
}

function normalizeStoredPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let candidate = value.trim();
  if (/^https?:\/\//i.test(candidate)) {
    try {
      candidate = new URL(candidate).pathname;
    } catch {
      return null;
    }
  }
  candidate = candidate.split("?")[0].split("#")[0];
  const mount = STORAGE_MOUNTS.find(({ prefix }) =>
    candidate.startsWith(`${prefix}/`),
  );
  return mount ? candidate : null;
}

function resolveStoredPath(storedPath) {
  const normalized = normalizeStoredPath(storedPath);
  if (!normalized) return null;
  const mount = STORAGE_MOUNTS.find(({ prefix }) =>
    normalized.startsWith(`${prefix}/`),
  );
  const relative = normalized.slice(mount.prefix.length + 1);
  const absolutePath = path.resolve(mount.root, ...relative.split("/").filter(Boolean));
  const rootWithSeparator = `${path.resolve(mount.root)}${path.sep}`;
  if (!absolutePath.startsWith(rootWithSeparator)) return null;
  return absolutePath;
}

function diskFileToStoredPath(absolutePath) {
  const resolved = path.resolve(absolutePath);
  for (const mount of STORAGE_MOUNTS) {
    const root = path.resolve(mount.root);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    return `${mount.prefix}/${relative.split(path.sep).join("/")}`;
  }
  return null;
}

function checksumFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function walkFiles(root) {
  const output = [];
  const pending = [path.resolve(root)];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = await fsPromises.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolutePath);
      if (entry.isFile()) output.push(absolutePath);
    }
  }
  return output;
}

async function collectDiskFiles({ verifyChecksums = true } = {}) {
  const records = [];
  for (const mount of STORAGE_MOUNTS) {
    for (const absolutePath of await walkFiles(mount.root)) {
      const stat = await fsPromises.stat(absolutePath);
      records.push({
        stored_path: diskFileToStoredPath(absolutePath),
        size_bytes: stat.size,
        modified_at: stat.mtime.toISOString(),
        checksum: verifyChecksums ? await checksumFile(absolutePath) : null,
      });
    }
  }
  return records;
}

function extractJsonReferences(value, context, output) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      extractJsonReferences(item, { ...context, json_path: `${context.json_path}[${index}]` }, output),
    );
    return;
  }
  if (!value || typeof value !== "object") return;

  const declaredChecksum =
    typeof value.checksum === "string" ? value.checksum.trim().toLowerCase() : null;
  for (const [key, item] of Object.entries(value)) {
    const jsonPath = `${context.json_path}.${key}`;
    const storedPath = normalizeStoredPath(item);
    if (storedPath) {
      output.push({
        stored_path: storedPath,
        checksum: declaredChecksum,
        source: { ...context, json_path: jsonPath },
      });
      continue;
    }
    extractJsonReferences(item, { ...context, json_path: jsonPath }, output);
  }
}

async function collectDatabaseReferences(prismaClient) {
  const columns = await prismaClient.$queryRawUnsafe(`
    SELECT
      c.table_name,
      c.column_name,
      c.data_type,
      EXISTS (
        SELECT 1 FROM information_schema.columns idc
        WHERE idc.table_schema = c.table_schema
          AND idc.table_name = c.table_name
          AND idc.column_name = 'id'
      ) AS has_id,
      EXISTS (
        SELECT 1 FROM information_schema.columns cc
        WHERE cc.table_schema = c.table_schema
          AND cc.table_name = c.table_name
          AND cc.column_name = 'checksum'
      ) AS has_checksum
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.data_type IN ('text', 'character varying', 'json', 'jsonb')
      AND (c.column_name ILIKE '%file%' OR c.column_name ILIKE '%path%')
    ORDER BY c.table_name, c.ordinal_position
  `);
  const references = [];

  for (const column of columns) {
    const tableName = quoteIdentifier(column.table_name);
    const columnName = quoteIdentifier(column.column_name);
    const idExpression = column.has_id ? `${quoteIdentifier("id")}::text` : "NULL::text";
    const checksumExpression = column.has_checksum
      ? `${quoteIdentifier("checksum")}::text`
      : "NULL::text";
    const rows = await prismaClient.$queryRawUnsafe(`
      SELECT ${idExpression} AS record_id,
             ${columnName} AS value,
             ${checksumExpression} AS checksum
      FROM ${tableName}
      WHERE ${columnName} IS NOT NULL
    `);

    for (const row of rows) {
      const context = {
        table: column.table_name,
        column: column.column_name,
        record_id: row.record_id || null,
        json_path: "$",
      };
      if (["json", "jsonb"].includes(column.data_type)) {
        extractJsonReferences(row.value, context, references);
        continue;
      }
      const storedPath = normalizeStoredPath(row.value);
      if (!storedPath) continue;
      references.push({
        stored_path: storedPath,
        checksum:
          typeof row.checksum === "string" ? row.checksum.trim().toLowerCase() : null,
        source: context,
      });
    }
  }

  return references;
}

function groupBy(items, keySelector) {
  const grouped = new Map();
  for (const item of items) {
    const key = keySelector(item);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return grouped;
}

function buildStorageReconciliation({ databaseReferences, diskFiles }) {
  const referencesByPath = groupBy(databaseReferences, (item) => item.stored_path);
  const diskByPath = new Map(diskFiles.map((item) => [item.stored_path, item]));
  const missingFiles = [];
  const checksumMismatches = [];

  for (const [storedPath, references] of referencesByPath) {
    const diskFile = diskByPath.get(storedPath);
    if (!diskFile) {
      missingFiles.push({ stored_path: storedPath, references: references.map((item) => item.source) });
      continue;
    }
    for (const reference of references) {
      if (
        reference.checksum &&
        diskFile.checksum &&
        reference.checksum !== diskFile.checksum
      ) {
        checksumMismatches.push({
          stored_path: storedPath,
          expected_checksum: reference.checksum,
          actual_checksum: diskFile.checksum,
          source: reference.source,
        });
      }
    }
  }

  const orphanFiles = diskFiles.filter((item) => !referencesByPath.has(item.stored_path));
  const duplicateReferences = [...referencesByPath.entries()]
    .filter(([, references]) => references.length > 1)
    .map(([storedPath, references]) => ({
      stored_path: storedPath,
      reference_count: references.length,
      references: references.map((item) => item.source),
    }));
  const duplicateContents = [...groupBy(diskFiles, (item) => item.checksum).entries()]
    .filter(([, files]) => files.length > 1)
    .map(([checksum, files]) => ({
      checksum,
      size_bytes: files[0].size_bytes,
      files: files.map((item) => item.stored_path),
    }));

  return {
    dry_run: true,
    generated_at: new Date().toISOString(),
    summary: {
      database_references: databaseReferences.length,
      unique_database_paths: referencesByPath.size,
      disk_files: diskFiles.length,
      missing_files: missingFiles.length,
      orphan_candidates: orphanFiles.length,
      duplicate_reference_paths: duplicateReferences.length,
      duplicate_content_groups: duplicateContents.length,
      checksum_mismatches: checksumMismatches.length,
    },
    missing_files: missingFiles,
    orphan_candidates: orphanFiles,
    duplicate_references: duplicateReferences,
    duplicate_contents: duplicateContents,
    checksum_mismatches: checksumMismatches,
  };
}

async function reconcileStorage({ prismaClient, verifyChecksums = true } = {}) {
  const [databaseReferences, diskFiles] = await Promise.all([
    collectDatabaseReferences(prismaClient),
    collectDiskFiles({ verifyChecksums }),
  ]);
  return buildStorageReconciliation({ databaseReferences, diskFiles });
}

module.exports = {
  STORAGE_MOUNTS,
  buildStorageReconciliation,
  collectDatabaseReferences,
  collectDiskFiles,
  diskFileToStoredPath,
  extractJsonReferences,
  normalizeStoredPath,
  reconcileStorage,
  resolveStoredPath,
};
