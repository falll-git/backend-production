const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOTS = ["src", "prisma", "scripts"];

function collectJavaScriptFiles(directory, store = []) {
  if (!fs.existsSync(directory)) return store;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      collectJavaScriptFiles(fullPath, store);
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".js")) {
      store.push(fullPath);
    }
  }

  return store;
}

const files = ROOTS.flatMap((root) => collectJavaScriptFiles(root));

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    process.stderr.write(`Syntax check failed: ${file}\n`);
    process.stderr.write(result.stderr || result.stdout || "");
    process.exit(result.status || 1);
  }
}

console.log(`Syntax check passed: ${files.length} JS files.`);
