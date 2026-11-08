// Test source resolution only. Never loads a peer environment or runtime config.
const fs = require('node:fs');
const path = require('node:path');
const bankRoot = path.resolve(__dirname, '../../..');
const names = Object.freeze({control: ['ruwang-control', 'ruwang-control'], central: ['seputarjaminan-production', 'seputarjaminan'], frontend: ['frontend-production', 'ruang-arsip']});
function peerRoot(kind, root = bankRoot) {
  const entry = names[kind];
  if (!entry) throw Error('UNKNOWN_TEST_PEER');
  const resolved = path.resolve(root, '..', entry[0]);
  const pkg = JSON.parse(fs.readFileSync(path.join(resolved, 'package.json'), 'utf8'));
  if (pkg.name !== entry[1]) throw Error('TEST_PEER_PACKAGE_MISMATCH');
  return resolved;
}
const controlPath = (...parts) => path.join(peerRoot('control'), ...parts);
const centralPath = (...parts) => path.join(peerRoot('central'), ...parts);
const bankPath = (...parts) => path.join(bankRoot, ...parts);
module.exports = {peerRoot, controlPath, centralPath, bankPath};
