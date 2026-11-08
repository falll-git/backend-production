// File transport for credential-free browser instrumentation only. Login code
// must not use this helper. The caller owns the existing evidence directory.
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, randomUUID } = require('node:crypto');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const arrow = /^(?:async\s*)?(?:\(\s*(?:[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)?\s*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{[\s\S]*\}$/;

function compile(source) {
  if (typeof source !== 'string' || !arrow.test(source.trim())) {
    throw new TypeError('Browser instrumentation must be one block-bodied arrow function.');
  }
  // The first context rejects statements; the second rejects a top-level comma
  // expression. Neither script is executed, including defaults or function body.
  new vm.Script(`(${source}\n)`, { filename: 'browser-instrumentation.js' });
  new vm.Script(`class BrowserInstrumentation { run = ${source}\n}`, {
    filename: 'browser-instrumentation-shape.js',
  });
}

async function cleanup(filename, identity, checksum) {
  let current;
  try {
    current = await fs.lstat(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino ||
      (checksum !== undefined && hash(await fs.readFile(filename)) !== checksum)) {
    throw new Error('Browser instrumentation cleanup refused: file ownership changed.');
  }
  await fs.unlink(filename);
}

async function runBrowserCode({ out, source, execute }) {
  if (typeof out !== 'string' || !path.isAbsolute(out)) {
    throw new TypeError('Browser instrumentation requires an absolute evidence directory.');
  }
  if (typeof execute !== 'function') throw new TypeError('Browser execution callback is required.');
  const directory = await fs.lstat(out);
  if (!directory.isDirectory()) throw new TypeError('Evidence target must be an existing directory.');
  const canonicalDirectory = await fs.realpath(out);
  compile(source);

  const filename = path.join(canonicalDirectory, `sj-browser-code-${randomUUID()}.js`);
  let handle;
  let identity;
  let checksum;
  try {
    // mode 0600 applies on POSIX; NTFS access remains governed by directory ACLs.
    handle = await fs.open(filename, 'wx', 0o600);
    identity = await handle.stat();
    await handle.writeFile(source, 'utf8');
    checksum = hash(Buffer.from(source, 'utf8'));
    await handle.close();
    handle = undefined;
    return await execute(filename);
  } finally {
    if (handle) await handle.close();
    if (identity) await cleanup(filename, identity, checksum);
  }
}

module.exports = { runBrowserCode };
