function parseOptions(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--") || token.length < 3) {
      throw new Error(`Argumen tidak dikenal: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Argumen --${key} membutuhkan nilai.`);
    }
    if (Object.hasOwn(options, key)) {
      throw new Error(`Argumen --${key} tidak boleh diulang.`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function requireOption(options, key) {
  const value = String(options[key] || "").trim();
  if (!value) throw new Error(`Argumen --${key} wajib diisi.`);
  return value;
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = { parseOptions, printResult, requireOption };
