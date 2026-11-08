'use strict';

// Read-only verifier for an already installed, explicitly pinned CLI tree.
// Resolving modules does not import the CLI, run its notifier, or start a browser.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');

const files = Object.freeze({
  cliPackage: '@playwright/cli/package.json',
  cliEntry: '@playwright/cli/playwright-cli.js',
  skillCheck: '@playwright/cli/skillCheck.js',
  corePackage: 'playwright-core/package.json',
  coreProgram: 'playwright-core/lib/tools/cli-client/program.js',
  coreBundle: 'playwright-core/lib/coreBundle.js',
  playwrightPackage: 'playwright/package.json',
});
const versionKeys = ['cliVersion', 'coreVersion', 'playwrightVersion'];
const sortedKeys = value => Object.keys(value).sort();
const isRecord = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function validVersion(value) {
  if (typeof value !== 'string') return false;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  return Boolean(match && (!match[4] || match[4].split('.').every(identifier =>
    !/^\d+$/.test(identifier) || identifier === '0' || !identifier.startsWith('0'))));
}

function resolveCliToolchain({ root, pin } = {}) {
  assert.ok(typeof root === 'string' && path.isAbsolute(root), 'TOOLCHAIN_ROOT_INVALID');
  assert.ok(isRecord(pin), 'TOOLCHAIN_PIN_INVALID');
  assert.deepEqual(sortedKeys(pin), [...versionKeys, 'sha256'].sort(), 'TOOLCHAIN_PIN_KEYS_INVALID');
  for (const key of versionKeys) assert.ok(validVersion(pin[key]), 'TOOLCHAIN_PIN_VERSION_INVALID');
  assert.ok(isRecord(pin.sha256), 'TOOLCHAIN_PIN_HASHES_INVALID');
  assert.deepEqual(sortedKeys(pin.sha256), sortedKeys(files), 'TOOLCHAIN_PIN_HASH_KEYS_INVALID');
  for (const hash of Object.values(pin.sha256))
    assert.ok(typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash), 'TOOLCHAIN_PIN_HASH_INVALID');

  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
    assert.ok(fs.statSync(realRoot).isDirectory(), 'TOOLCHAIN_ROOT_NOT_DIRECTORY');
  } catch {
    throw new Error('TOOLCHAIN_ROOT_UNAVAILABLE');
  }

  const resolved = {};
  const hashes = {};
  const contents = {};
  for (const [key, relative] of Object.entries(files)) {
    const expected = path.resolve(realRoot, relative);
    try {
      resolved[key] = fs.realpathSync(expected);
      assert.equal(resolved[key], expected, 'TOOLCHAIN_FILE_OUTSIDE_TREE');
      assert.ok(fs.statSync(expected).isFile(), 'TOOLCHAIN_FILE_NOT_REGULAR');
      contents[key] = fs.readFileSync(expected);
    } catch {
      throw new Error('TOOLCHAIN_FILE_UNAVAILABLE_OR_OUTSIDE_TREE');
    }
    hashes[key] = crypto.createHash('sha256').update(contents[key]).digest('hex');
    assert.equal(hashes[key], pin.sha256[key], 'TOOLCHAIN_HASH_MISMATCH');
  }

  let cliPackage, corePackage, playwrightPackage;
  try {
    cliPackage = JSON.parse(contents.cliPackage.toString('utf8'));
    corePackage = JSON.parse(contents.corePackage.toString('utf8'));
    playwrightPackage = JSON.parse(contents.playwrightPackage.toString('utf8'));
  } catch {
    throw new Error('TOOLCHAIN_PACKAGE_JSON_INVALID');
  }
  for (const [packageJson, name, version] of [
    [cliPackage, '@playwright/cli', pin.cliVersion],
    [corePackage, 'playwright-core', pin.coreVersion],
    [playwrightPackage, 'playwright', pin.playwrightVersion],
  ]) {
    assert.ok(isRecord(packageJson) && packageJson.name === name, 'TOOLCHAIN_PACKAGE_IDENTITY_INVALID');
    assert.ok(validVersion(packageJson.version), 'TOOLCHAIN_PACKAGE_VERSION_INVALID');
    assert.equal(packageJson.version, version, 'TOOLCHAIN_VERSION_MISMATCH');
  }
  assert.equal(cliPackage.bin?.['playwright-cli'], 'playwright-cli.js', 'TOOLCHAIN_ENTRY_DECLARATION_INVALID');
  assert.equal(cliPackage.dependencies?.['playwright-core'], pin.coreVersion, 'TOOLCHAIN_CLI_CORE_DEPENDENCY_MISMATCH');
  assert.equal(cliPackage.dependencies?.playwright, pin.playwrightVersion, 'TOOLCHAIN_CLI_PLAYWRIGHT_DEPENDENCY_MISMATCH');
  assert.equal(playwrightPackage.dependencies?.['playwright-core'], pin.coreVersion, 'TOOLCHAIN_PLAYWRIGHT_CORE_DEPENDENCY_MISMATCH');

  const fromEntry = createRequire(resolved.cliEntry);
  const fromPlaywright = createRequire(resolved.playwrightPackage);
  for (const [resolver, spec, expectedKey] of [
    [fromEntry, './package.json', 'cliPackage'],
    [fromEntry, './skillCheck', 'skillCheck'],
    [fromEntry, 'playwright-core/package.json', 'corePackage'],
    [fromEntry, 'playwright-core/lib/tools/cli-client/program', 'coreProgram'],
    [fromEntry, 'playwright-core/lib/coreBundle', 'coreBundle'],
    [fromEntry, 'playwright/package.json', 'playwrightPackage'],
    [fromPlaywright, 'playwright-core/package.json', 'corePackage'],
  ]) {
    let actual;
    try {
      actual = fs.realpathSync(resolver.resolve(spec));
    } catch {
      throw new Error('TOOLCHAIN_DEPENDENCY_RESOLUTION_UNAVAILABLE');
    }
    assert.equal(actual, resolved[expectedKey], 'TOOLCHAIN_DEPENDENCY_RESOLUTION_MISMATCH');
  }

  return Object.freeze({ root: realRoot, entry: resolved.cliEntry,
    cliVersion: pin.cliVersion, coreVersion: pin.coreVersion, playwrightVersion: pin.playwrightVersion,
    sha256: Object.freeze(hashes), resolved: Object.freeze(resolved),
    verifiedBy: 'realpath-createRequire-resolution-and-static-sha256-pin',
    cliExecuted: false, browserStarted: false });
}

module.exports = { resolveCliToolchain };
