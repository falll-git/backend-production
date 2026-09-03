const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MANIFEST_FILE = "release-manifest.json";
const PREFLIGHT_FILE = ".atomic-preflight.json";
const STATE_FILE = "deployment-state.json";
const STRATEGY = "manual-atomic-symlink";
const COMPONENT_NAMES = Object.freeze(["backend", "frontend"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "coverage",
  "node_modules",
  "performance-reports",
  "playwright-report",
  "quality-reports",
  "release-reports",
  "test-results",
]);

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

function assertAbsoluteSafeRoot(value) {
  const configured = String(value || "").trim();
  if (!configured || !path.isAbsolute(configured)) {
    throw new Error("Deploy root wajib berupa absolute path.");
  }
  const resolved = path.resolve(configured);
  const filesystemRoot = path.parse(resolved).root;
  if (resolved === filesystemRoot || resolved === path.resolve(os.homedir())) {
    throw new Error("Deploy root tidak boleh menunjuk filesystem root atau home directory.");
  }
  return resolved;
}

function assertReleaseId(value) {
  const releaseId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,95}$/.test(releaseId)) {
    throw new Error("Release ID wajib 6-96 karakter aman tanpa path separator.");
  }
  return releaseId;
}

function assertCommitSha(value, label) {
  const commitSha = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error(`Commit SHA ${label} wajib berisi 40 karakter heksadesimal.`);
  }
  return commitSha;
}

function releasePaths(deployRoot, releaseId) {
  const root = assertAbsoluteSafeRoot(deployRoot);
  const id = assertReleaseId(releaseId);
  return {
    deployRoot: root,
    releaseId: id,
    releasesRoot: path.join(root, "releases"),
    releaseRoot: path.join(root, "releases", id),
    sharedRoot: path.join(root, "shared"),
    currentPath: path.join(root, "current"),
  };
}

function lstatIfExists(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function initializeReleaseLayout(deployRoot) {
  const root = assertAbsoluteSafeRoot(deployRoot);
  if (fs.existsSync(path.join(root, ".git"))) {
    throw new Error("Deploy root tidak boleh memakai working tree Git.");
  }
  const directories = [
    path.join(root, "releases"),
    path.join(root, "shared", "env"),
    path.join(root, "shared", "logs"),
    path.join(root, "shared", "reports"),
    path.join(root, "shared", "uploads"),
    path.join(root, "shared", "seputar-jaminan-public"),
  ];
  for (const directory of directories) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return { deploy_root: root, directories };
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isForbiddenEnvironmentFile(name) {
  return /^\.env(?:\..+)?$/i.test(name) && name !== ".env.example";
}

function collectComponentFiles(componentRoot) {
  const resolvedRoot = path.resolve(componentRoot);
  if (!fs.statSync(resolvedRoot).isDirectory()) {
    throw new Error(`Component root bukan direktori: ${resolvedRoot}`);
  }
  const files = [];
  const visit = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      if (isForbiddenEnvironmentFile(entry.name)) {
        throw new Error(`Environment file tidak boleh berada di release component: ${entry.name}`);
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Symlink tidak boleh berada di release component: ${absolutePath}`);
      }
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(resolvedRoot, absolutePath).split(path.sep).join("/");
      const stat = fs.statSync(absolutePath);
      files.push({
        path: relativePath,
        bytes: stat.size,
        sha256: sha256File(absolutePath),
      });
    }
  };
  visit(resolvedRoot);
  return files;
}

function createReleaseManifest({
  deployRoot,
  releaseId,
  backendCommitSha,
  frontendCommitSha,
  createdAt = new Date(),
} = {}) {
  const paths = releasePaths(deployRoot, releaseId);
  if (!fs.existsSync(paths.releaseRoot)) {
    throw new Error("Release directory belum tersedia.");
  }
  const manifestPath = path.join(paths.releaseRoot, MANIFEST_FILE);
  if (fs.existsSync(manifestPath)) {
    throw new Error("Release manifest sudah tersedia dan tidak boleh ditimpa.");
  }
  const commitShas = {
    backend: assertCommitSha(backendCommitSha, "backend"),
    frontend: assertCommitSha(frontendCommitSha, "frontend"),
  };
  const components = {};
  for (const componentName of COMPONENT_NAMES) {
    const componentRoot = path.join(paths.releaseRoot, componentName);
    components[componentName] = {
      root: componentName,
      commit_sha: commitShas[componentName],
      files: collectComponentFiles(componentRoot),
    };
    if (components[componentName].files.length === 0) {
      throw new Error(`Release component ${componentName} tidak boleh kosong.`);
    }
  }
  const manifest = {
    schema_version: 1,
    strategy: STRATEGY,
    release_id: paths.releaseId,
    created_at: createdAt.toISOString(),
    automatic_deployment: false,
    components,
  };
  writeJsonAtomic(manifestPath, manifest);
  return { manifest, manifest_path: manifestPath, sha256: sha256File(manifestPath) };
}

function validateManifestShape(manifest, expectedReleaseId) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Release manifest wajib berupa object.");
  }
  if (
    manifest.schema_version !== 1 ||
    manifest.strategy !== STRATEGY ||
    manifest.automatic_deployment !== false ||
    manifest.release_id !== expectedReleaseId
  ) {
    throw new Error("Kontrak release manifest tidak sesuai deployment manual-atomic.");
  }
  if (!Number.isFinite(Date.parse(manifest.created_at))) {
    throw new Error("created_at release manifest tidak valid.");
  }
  for (const componentName of COMPONENT_NAMES) {
    const component = manifest.components?.[componentName];
    assertCommitSha(component?.commit_sha, componentName);
    if (component?.root !== componentName || !Array.isArray(component.files)) {
      throw new Error(`Kontrak component ${componentName} tidak valid.`);
    }
    const seen = new Set();
    for (const entry of component.files) {
      const entryPath = String(entry?.path || "");
      if (
        !entryPath ||
        entryPath.includes("\\") ||
        path.posix.isAbsolute(entryPath) ||
        entryPath.split("/").includes("..") ||
        seen.has(entryPath) ||
        !Number.isInteger(entry?.bytes) ||
        entry.bytes < 0 ||
        !/^[0-9a-f]{64}$/.test(String(entry?.sha256 || ""))
      ) {
        throw new Error(`Entry manifest ${componentName} tidak valid.`);
      }
      seen.add(entryPath);
    }
  }
}

function verifyReleaseManifest({ deployRoot, releaseId } = {}) {
  const paths = releasePaths(deployRoot, releaseId);
  const manifestPath = path.join(paths.releaseRoot, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) throw new Error("Release manifest tidak ditemukan.");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  validateManifestShape(manifest, paths.releaseId);
  for (const componentName of COMPONENT_NAMES) {
    const actual = collectComponentFiles(path.join(paths.releaseRoot, componentName));
    const expected = manifest.components[componentName].files;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Checksum atau daftar file ${componentName} tidak sesuai manifest.`);
    }
  }
  return {
    release_id: paths.releaseId,
    manifest_path: manifestPath,
    manifest_sha256: sha256File(manifestPath),
    component_count: COMPONENT_NAMES.length,
  };
}

function assertPrivateFileOnPosix(filePath) {
  if (process.platform === "win32") return;
  const permissions = fs.statSync(filePath).mode & 0o777;
  if ((permissions & 0o077) !== 0) {
    throw new Error(`Permission environment file wajib 0600: ${filePath}`);
  }
}

function verifySharedLayout(sharedRoot) {
  const requiredDirectories = [
    "logs",
    "reports",
    "uploads",
    "seputar-jaminan-public",
  ];
  for (const relativePath of requiredDirectories) {
    const target = path.join(sharedRoot, relativePath);
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      throw new Error(`Shared directory belum tersedia: ${relativePath}`);
    }
  }
  for (const filename of ["backend.env", "frontend.env"]) {
    const target = path.join(sharedRoot, "env", filename);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error(`Shared environment file belum tersedia: ${filename}`);
    }
    assertPrivateFileOnPosix(target);
  }
}

function verifyApplicationPreflightReport(
  reportPath,
  expectedReleaseId,
  expectedReleaseRoot,
) {
  const configured = String(reportPath || "").trim();
  if (!configured || !path.isAbsolute(configured)) {
    throw new Error("Application preflight report wajib berupa absolute path.");
  }
  const resolved = path.resolve(configured);
  const releaseRoot = path.resolve(expectedReleaseRoot);
  const relative = path.relative(releaseRoot, resolved);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Application preflight report wajib berada di dalam release target.");
  }
  let descriptor;
  let content;
  try {
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    if (!fs.fstatSync(descriptor).isFile()) {
      throw new Error("Application preflight report wajib berupa file biasa.");
    }
    content = fs.readFileSync(descriptor);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Application preflight report tidak ditemukan.", { cause: error });
    }
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  const report = JSON.parse(content.toString("utf8"));
  if (
    report?.schema_version !== 1 ||
    report?.kind !== "preflight" ||
    report?.status !== "passed" ||
    report?.automatic_deployment !== false ||
    report?.release_id !== expectedReleaseId ||
    !Array.isArray(report?.checks) ||
    report.checks.length === 0 ||
    !report.checks.every((check) => check?.status === "passed")
  ) {
    throw new Error("Application preflight report belum menyatakan seluruh check lulus.");
  }
  return {
    path: resolved,
    relative_path: relative.split(path.sep).join("/"),
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  };
}

function runAtomicPreflight({
  deployRoot,
  releaseId,
  applicationPreflightReportPath,
  checkedAt = new Date(),
} = {}) {
  const paths = releasePaths(deployRoot, releaseId);
  const verification = verifyReleaseManifest({ deployRoot, releaseId });
  verifySharedLayout(paths.sharedRoot);
  const applicationPreflight = verifyApplicationPreflightReport(
    applicationPreflightReportPath,
    paths.releaseId,
    paths.releaseRoot,
  );
  const requiredFiles = [
    path.join(paths.releaseRoot, "backend", "package.json"),
    path.join(paths.releaseRoot, "frontend", "package.json"),
    path.join(paths.releaseRoot, "frontend", ".next", "BUILD_ID"),
  ];
  for (const requiredFile of requiredFiles) {
    if (!fs.existsSync(requiredFile) || !fs.statSync(requiredFile).isFile()) {
      throw new Error(`Artefak release wajib belum tersedia: ${requiredFile}`);
    }
  }
  const migrationsRoot = path.join(paths.releaseRoot, "backend", "prisma", "migrations");
  if (
    !fs.existsSync(migrationsRoot) ||
    !fs.readdirSync(migrationsRoot, { withFileTypes: true }).some((entry) => entry.isDirectory())
  ) {
    throw new Error("Prisma migration release belum tersedia.");
  }
  const marker = {
    schema_version: 1,
    status: "passed",
    release_id: paths.releaseId,
    manifest_sha256: verification.manifest_sha256,
    application_preflight_report: applicationPreflight.relative_path,
    application_preflight_sha256: applicationPreflight.sha256,
    checked_at: checkedAt.toISOString(),
    scope: "structural-and-application",
    automatic_deployment: false,
  };
  writeJsonAtomic(path.join(paths.releaseRoot, PREFLIGHT_FILE), marker);
  return marker;
}

function verifyPreflightMarker(paths) {
  const markerPath = path.join(paths.releaseRoot, PREFLIGHT_FILE);
  if (!fs.existsSync(markerPath)) throw new Error("Atomic preflight belum dijalankan.");
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  const manifestPath = path.join(paths.releaseRoot, MANIFEST_FILE);
  const applicationPreflightPath = path.resolve(
    paths.releaseRoot,
    String(marker?.application_preflight_report || ""),
  );
  const applicationPreflight = verifyApplicationPreflightReport(
    applicationPreflightPath,
    paths.releaseId,
    paths.releaseRoot,
  );
  if (
    marker?.status !== "passed" ||
    marker?.release_id !== paths.releaseId ||
    marker?.manifest_sha256 !== sha256File(manifestPath) ||
    marker?.application_preflight_sha256 !== applicationPreflight.sha256
  ) {
    throw new Error("Atomic preflight marker tidak sesuai release manifest.");
  }
}

function resolveCurrentReleaseId(deployRoot) {
  const root = assertAbsoluteSafeRoot(deployRoot);
  const currentPath = path.join(root, "current");
  const currentStat = lstatIfExists(currentPath);
  if (!currentStat) return null;
  if (!currentStat.isSymbolicLink()) {
    throw new Error("Path current wajib berupa symlink, bukan direktori atau file biasa.");
  }
  const target = fs.realpathSync(currentPath);
  const releasesRoot = path.join(root, "releases");
  const relative = path.relative(releasesRoot, target);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).length !== 1
  ) {
    throw new Error("Symlink current tidak menunjuk satu release yang valid.");
  }
  return assertReleaseId(relative);
}

function replaceCurrentLink(paths) {
  const temporaryLink = path.join(
    paths.deployRoot,
    `.current-next-${process.pid}-${Date.now()}`,
  );
  const target = process.platform === "win32"
    ? paths.releaseRoot
    : path.join("releases", paths.releaseId);
  fs.symlinkSync(target, temporaryLink, process.platform === "win32" ? "junction" : "dir");
  if (!lstatIfExists(paths.currentPath)) {
    fs.renameSync(temporaryLink, paths.currentPath);
    return;
  }
  if (process.platform !== "win32") {
    fs.renameSync(temporaryLink, paths.currentPath);
    return;
  }
  const backupLink = path.join(
    paths.deployRoot,
    `.current-previous-${process.pid}-${Date.now()}`,
  );
  fs.renameSync(paths.currentPath, backupLink);
  try {
    fs.renameSync(temporaryLink, paths.currentPath);
  } catch (error) {
    fs.renameSync(backupLink, paths.currentPath);
    if (fs.existsSync(temporaryLink)) fs.unlinkSync(temporaryLink);
    throw error;
  }
  fs.unlinkSync(backupLink);
}

function activateRelease({
  deployRoot,
  releaseId,
  expectedCurrentReleaseId = null,
  switchedAt = new Date(),
} = {}) {
  const paths = releasePaths(deployRoot, releaseId);
  verifyReleaseManifest({ deployRoot, releaseId });
  verifyPreflightMarker(paths);
  const currentReleaseId = resolveCurrentReleaseId(paths.deployRoot);
  if (expectedCurrentReleaseId !== null) {
    const expected = assertReleaseId(expectedCurrentReleaseId);
    if (currentReleaseId !== expected) {
      throw new Error(`Current release berubah: diharapkan ${expected}, ditemukan ${currentReleaseId || "none"}.`);
    }
  }
  if (currentReleaseId === paths.releaseId) {
    throw new Error("Release target sudah aktif.");
  }
  replaceCurrentLink(paths);
  const state = {
    schema_version: 1,
    strategy: STRATEGY,
    current_release: paths.releaseId,
    previous_release: currentReleaseId,
    switched_at: switchedAt.toISOString(),
    automatic_deployment: false,
  };
  writeJsonAtomic(path.join(paths.sharedRoot, STATE_FILE), state);
  return state;
}

function rollbackRelease({ deployRoot, toReleaseId, expectedCurrentReleaseId } = {}) {
  if (!expectedCurrentReleaseId) {
    throw new Error("Rollback wajib menyebut current release yang diharapkan.");
  }
  return activateRelease({
    deployRoot,
    releaseId: toReleaseId,
    expectedCurrentReleaseId,
  });
}

module.exports = {
  COMPONENT_NAMES,
  MANIFEST_FILE,
  PREFLIGHT_FILE,
  STATE_FILE,
  STRATEGY,
  activateRelease,
  assertAbsoluteSafeRoot,
  assertReleaseId,
  collectComponentFiles,
  createReleaseManifest,
  initializeReleaseLayout,
  releasePaths,
  resolveCurrentReleaseId,
  rollbackRelease,
  runAtomicPreflight,
  sha256File,
  validateManifestShape,
  verifyReleaseManifest,
  verifyApplicationPreflightReport,
  verifySharedLayout,
};
