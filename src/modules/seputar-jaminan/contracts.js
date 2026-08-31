const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const contractRoot = path.resolve(
  __dirname,
  "../../../vendor/seputar-jaminan-contracts-v1",
);
let contractPromise;

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function verifyVendoredContract() {
  const manifestPath = path.join(contractRoot, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    manifest.package !== "@seputarjaminan/contracts" ||
    manifest.version !== "1.0.0"
  ) {
    throw new Error("Snapshot kontrak Seputar Jaminan V1 tidak dikenali.");
  }
  for (const [relativePath, expectedHash] of Object.entries(manifest.files || {})) {
    const filePath = path.resolve(contractRoot, relativePath);
    const relative = path.relative(contractRoot, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Manifest kontrak memuat path di luar folder vendor.");
    }
    if (sha256(filePath) !== expectedHash) {
      throw new Error(`Checksum kontrak tidak cocok: ${relativePath}`);
    }
  }
  return manifest;
}

async function getContracts() {
  if (!contractPromise) {
    verifyVendoredContract();
    contractPromise = import(
      pathToFileURL(path.join(contractRoot, "src", "index.mjs")).href
    );
  }
  return contractPromise;
}

module.exports = { contractRoot, getContracts, verifyVendoredContract };
