const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const destinationRoot = path.join(
  repositoryRoot,
  "vendor",
  "seputar-jaminan-contracts-v1",
);
const sourceRoot = path.resolve(
  process.env.SJ_CONTRACTS_SOURCE_DIR ||
    path.join(repositoryRoot, "..", "seputarjaminan-production", "packages", "contracts"),
);

function assertWithin(parent, target, label) {
  const relative = path.relative(parent, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} harus berada di dalam ${parent}.`);
  }
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function listFiles(directory, root = directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? listFiles(fullPath, root)
        : [path.relative(root, fullPath).replaceAll(path.sep, "/")];
    })
    .sort();
}

function syncContracts() {
  assertWithin(repositoryRoot, destinationRoot, "Folder tujuan kontrak");
  const sourcePackagePath = path.join(sourceRoot, "package.json");
  const sourcePackage = JSON.parse(fs.readFileSync(sourcePackagePath, "utf8"));
  if (
    sourcePackage.name !== "@seputarjaminan/contracts" ||
    sourcePackage.version !== "1.0.0"
  ) {
    throw new Error("Kontrak sumber wajib @seputarjaminan/contracts versi 1.0.0.");
  }

  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const directory of ["schemas", "src"]) {
    fs.cpSync(path.join(sourceRoot, directory), path.join(destinationRoot, directory), {
      recursive: true,
      errorOnExist: false,
    });
  }

  const files = listFiles(destinationRoot);
  const manifest = {
    package: sourcePackage.name,
    version: sourcePackage.version,
    generated_from: "packages/contracts",
    files: Object.fromEntries(
      files.map((relativePath) => [
        relativePath,
        sha256(path.join(destinationRoot, relativePath)),
      ]),
    ),
  };
  fs.writeFileSync(
    path.join(destinationRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );
  return manifest;
}

if (require.main === module) {
  const manifest = syncContracts();
  console.log(
    JSON.stringify({
      status: "passed",
      package: manifest.package,
      version: manifest.version,
      file_count: Object.keys(manifest.files).length,
    }),
  );
}

module.exports = { destinationRoot, sourceRoot, syncContracts };
