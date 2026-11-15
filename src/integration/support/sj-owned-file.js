'use strict';

const fs = require('node:fs');
const path = require('node:path');

function unchanged(left, right) {
  return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);
}

// Open first, inspect and read that descriptor. Never trust a path stat as
// authority for a later path-based read. The final path identity also rejects
// replacement/junction races before these bytes can authorize a fixture action.
function readOwnedFileSync(filename, { maxBytes = Number.MAX_SAFE_INTEGER, io = fs } = {}) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw Error('OWNED_FILE_PATH_INVALID');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw Error('OWNED_FILE_BOUND_INVALID');
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
  const fd = io.openSync(filename, flags);
  try {
    const before = io.fstatSync(fd, { bigint: true });
    const link = io.lstatSync(filename, { bigint: true });
    if (!before.isFile() || !link.isFile() || link.isSymbolicLink() || before.size > BigInt(maxBytes) ||
        before.dev !== link.dev || before.ino !== link.ino || io.realpathSync(filename) !== path.resolve(filename)) {
      throw Error('OWNED_FILE_NOT_REGULAR_OR_REPLACED');
    }
    const chunks = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - total + 1));
      const count = io.readSync(fd, buffer, 0, buffer.length, null);
      if (!Number.isInteger(count) || count < 0 || count > buffer.length) throw Error('OWNED_FILE_READ_INVALID');
      if (count === 0) break;
      total += count;
      if (total > maxBytes) throw Error('OWNED_FILE_BOUND_EXCEEDED');
      chunks.push(buffer.subarray(0, count));
    }
    const bytes = Buffer.concat(chunks, total);
    const after = io.fstatSync(fd, { bigint: true });
    const current = io.lstatSync(filename, { bigint: true });
    if (bytes.length > maxBytes || BigInt(bytes.length) !== after.size || !unchanged(before, after) || !current.isFile() || current.isSymbolicLink() ||
        after.dev !== current.dev || after.ino !== current.ino || io.realpathSync(filename) !== path.resolve(filename)) {
      throw Error('OWNED_FILE_CHANGED_DURING_READ');
    }
    return { bytes, identity: after };
  } finally {
    io.closeSync(fd);
  }
}

module.exports = { readOwnedFileSync };
