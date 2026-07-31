const path = require("node:path");

const SAFE_STORAGE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function normalizePathCase(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function resolvePathInsideRoot(root, ...segments) {
  if (typeof root !== "string" || !root.trim()) return null;
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        typeof segment !== "string" ||
        !SAFE_STORAGE_SEGMENT.test(segment) ||
        segment === "." ||
        segment === ".." ||
        path.isAbsolute(segment),
    )
  ) {
    return null;
  }

  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, ...segments);
  const comparableRoot = normalizePathCase(resolvedRoot);
  const comparablePath = normalizePathCase(resolvedPath);
  const rootWithSeparator = `${comparableRoot}${path.sep}`;

  if (
    comparablePath === comparableRoot ||
    !comparablePath.startsWith(rootWithSeparator)
  ) {
    return null;
  }

  return resolvedPath;
}

function normalizeStorageEntity(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const segments = value.trim().split("/");
  return segments.every((segment) => SAFE_STORAGE_SEGMENT.test(segment))
    ? segments
    : null;
}

module.exports = {
  normalizeStorageEntity,
  resolvePathInsideRoot,
};
