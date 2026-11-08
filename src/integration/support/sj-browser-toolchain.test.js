'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveCliToolchain } = require('./sj-browser-toolchain');

const files = {
  cliPackage: '@playwright/cli/package.json',
  cliEntry: '@playwright/cli/playwright-cli.js',
  skillCheck: '@playwright/cli/skillCheck.js',
  corePackage: 'playwright-core/package.json',
  coreProgram: 'playwright-core/lib/tools/cli-client/program.js',
  coreBundle: 'playwright-core/lib/coreBundle.js',
  playwrightPackage: 'playwright/package.json',
};
const hash = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

function withTree(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sj-browser-toolchain-test-'));
  const realDirectory = fs.realpathSync(directory);
  const marker = crypto.randomBytes(24).toString('hex');
  const ownership = path.join(realDirectory, 'owned-run.json');
  const ownedFiles = new Set();
  const ownedDirectories = new Set([realDirectory]);
  const ownedLinks = new Map();
  const root = path.join(realDirectory, 'node_modules');
  const write = (relative, contents) => {
    const filename = path.resolve(root, relative);
    assert.ok(filename.startsWith(root + path.sep), 'fixture path must stay in its exact owned root');
    let parent = path.dirname(filename);
    const missing = [];
    while (!fs.existsSync(parent)) { missing.push(parent); parent = path.dirname(parent); }
    for (const item of missing.reverse()) { fs.mkdirSync(item); ownedDirectories.add(item); }
    if (!fs.existsSync(filename)) ownedFiles.add(filename);
    fs.writeFileSync(filename, contents);
    return filename;
  };
  fs.writeFileSync(ownership, JSON.stringify({ marker, directory: realDirectory }), { flag: 'wx' });
  ownedFiles.add(ownership);
  try {
    write(files.cliPackage, JSON.stringify({ name: '@playwright/cli', version: '0.1.22',
      bin: { 'playwright-cli': 'playwright-cli.js' },
      dependencies: { playwright: '1.64.0-alpha-1790635538000', 'playwright-core': '1.64.0-alpha-1790635538000' } }));
    write(files.corePackage, JSON.stringify({ name: 'playwright-core', version: '1.64.0-alpha-1790635538000',
      exports: { './package.json': './package.json', './lib/coreBundle': './lib/coreBundle.js',
        './lib/tools/cli-client/program': './lib/tools/cli-client/program.js' } }));
    write(files.playwrightPackage, JSON.stringify({ name: 'playwright', version: '1.64.0-alpha-1790635538000',
      dependencies: { 'playwright-core': '1.64.0-alpha-1790635538000' } }));
    for (const key of ['cliEntry', 'skillCheck', 'coreProgram', 'coreBundle'])
      write(files[key], "globalThis.sjToolchainUnexpectedImport = true; throw new Error('must not execute');\n");
    const makePin = () => ({ cliVersion: '0.1.22', coreVersion: '1.64.0-alpha-1790635538000',
      playwrightVersion: '1.64.0-alpha-1790635538000',
      sha256: Object.fromEntries(Object.entries(files).map(([key, relative]) => [key, hash(path.join(root, relative))])) });
    const linkDirectory = (relative, target) => {
      const filename = path.resolve(root, relative);
      assert.ok(filename.startsWith(root + path.sep), 'fixture link must stay in owned root');
      const placeholder = write(relative + '/owned-placeholder.txt', 'owned directory');
      fs.unlinkSync(placeholder);
      fs.rmdirSync(filename);
      ownedDirectories.delete(filename);
      fs.symlinkSync(target, filename, process.platform === 'win32' ? 'junction' : 'dir');
      ownedLinks.set(filename, fs.realpathSync(target));
      return filename;
    };
    return run({ root, write, makePin, linkDirectory, directory: realDirectory });
  } finally {
    assert.equal(fs.realpathSync(directory), realDirectory, 'fixture cleanup refuses replaced root');
    const current = JSON.parse(fs.readFileSync(ownership, 'utf8'));
    assert.equal(current.marker, marker, 'fixture cleanup refuses changed ownership');
    assert.equal(current.directory, realDirectory, 'fixture cleanup refuses changed path');
    for (const [filename, target] of ownedLinks) {
      assert.ok(filename.startsWith(realDirectory + path.sep), 'fixture link cleanup refuses outside target');
      assert.ok(fs.lstatSync(filename).isSymbolicLink(), 'fixture link cleanup refuses replacement');
      assert.equal(fs.realpathSync(filename), target, 'fixture link cleanup refuses changed destination');
      // Remove this exact owned link, never traverse/remove its destination.
      if (process.platform === 'win32') fs.rmdirSync(filename);
      else fs.unlinkSync(filename);
    }
    for (const filename of [...ownedFiles].reverse()) {
      assert.ok(filename.startsWith(realDirectory + path.sep), 'fixture cleanup refuses outside target');
      if (fs.existsSync(filename)) fs.unlinkSync(filename);
    }
    for (const item of [...ownedDirectories].sort((a, b) => b.length - a.length)) fs.rmdirSync(item);
  }
}

test('pure installed-tree verification resolves and hashes without executing any module', () => {
  withTree(({ root, makePin }) => {
    assert.equal(globalThis.sjToolchainUnexpectedImport, undefined);
    const descriptor = resolveCliToolchain({ root, pin: makePin() });
    assert.equal(descriptor.root, fs.realpathSync(root));
    assert.equal(descriptor.entry, path.join(root, files.cliEntry));
    assert.equal(descriptor.cliVersion, '0.1.22');
    assert.equal(descriptor.cliExecuted, false);
    assert.equal(descriptor.browserStarted, false);
    assert.equal(Object.isFrozen(descriptor), true);
    assert.equal(Object.isFrozen(descriptor.sha256), true);
    assert.equal(globalThis.sjToolchainUnexpectedImport, undefined);
  });
});

test('relative, missing and file roots or incomplete pins are rejected', () => {
  withTree(({ root, makePin }) => {
    const pin = makePin();
    for (const target of ['relative-root', path.join(root, 'missing'), path.join(root, files.cliEntry)])
      assert.throws(() => resolveCliToolchain({ root: target, pin }), /TOOLCHAIN_ROOT/);
    for (const invalid of [undefined, null, {}, { ...pin, extra: true }, { ...pin, sha256: {} },
      { ...pin, sha256: { ...pin.sha256, cliEntry: 'a'.repeat(63) } }])
      assert.throws(() => resolveCliToolchain({ root, pin: invalid }), /TOOLCHAIN_PIN/);
  });
});

test('strict numeric semantic versions reject floating ranges and malformed identifiers', () => {
  withTree(({ root, makePin }) => {
    for (const version of ['latest', '^0.1.22', 'v0.1.22', '01.1.22', '0.1', '0.1.22-',
      '0.1.22-01', '0.1.22-alpha..1', '0.1.22+'])
      assert.throws(() => resolveCliToolchain({ root, pin: { ...makePin(), cliVersion: version } }), /TOOLCHAIN_PIN_VERSION/);
  });
});

for (const changedKey of Object.keys(files)) {
  test('changed pinned bytes rejected before execution: ' + changedKey, () => {
    withTree(({ root, write, makePin }) => {
      const pin = makePin();
      write(files[changedKey], fs.readFileSync(path.join(root, files[changedKey]), 'utf8') + '\n');
      assert.throws(() => resolveCliToolchain({ root, pin }), /TOOLCHAIN_HASH_MISMATCH/);
      assert.equal(globalThis.sjToolchainUnexpectedImport, undefined);
    });
  });
}

test('actual package versions and identities must match pinned values even when bytes are repinned', () => {
  for (const changedKey of ['cliPackage', 'corePackage', 'playwrightPackage']) {
    withTree(({ root, write, makePin }) => {
      const original = JSON.parse(fs.readFileSync(path.join(root, files[changedKey]), 'utf8'));
      write(files[changedKey], JSON.stringify({ ...original, version: '9.9.9' }));
      assert.throws(() => resolveCliToolchain({ root, pin: makePin() }), /TOOLCHAIN_VERSION_MISMATCH/);
      write(files[changedKey], JSON.stringify({ ...original, name: 'unrelated-module' }));
      assert.throws(() => resolveCliToolchain({ root, pin: makePin() }), /TOOLCHAIN_PACKAGE_IDENTITY/);
    });
  }
});

test('declared dependency versions and entry must match exact pinned resolution', () => {
  for (const mutation of [
    value => { value.dependencies['playwright-core'] = '^1.64.0'; },
    value => { value.dependencies.playwright = 'latest'; },
    value => { value.bin['playwright-cli'] = 'other.js'; },
  ]) {
    withTree(({ root, write, makePin }) => {
      const value = JSON.parse(fs.readFileSync(path.join(root, files.cliPackage), 'utf8'));
      mutation(value); write(files.cliPackage, JSON.stringify(value));
      assert.throws(() => resolveCliToolchain({ root, pin: makePin() }), /TOOLCHAIN_(CLI_|ENTRY_)/);
    });
  }
  withTree(({ root, write, makePin }) => {
    const value = JSON.parse(fs.readFileSync(path.join(root, files.playwrightPackage), 'utf8'));
    value.dependencies['playwright-core'] = '9.9.9';
    write(files.playwrightPackage, JSON.stringify(value));
    assert.throws(() => resolveCliToolchain({ root, pin: makePin() }), /TOOLCHAIN_PLAYWRIGHT_CORE_DEPENDENCY/);
  });
});

test('module export redirection cannot resolve a different entry in the same tree', () => {
  withTree(({ root, write, makePin }) => {
    write('playwright-core/lib/other-program.js', 'throw new Error("must not execute");');
    const value = JSON.parse(fs.readFileSync(path.join(root, files.corePackage), 'utf8'));
    value.exports['./lib/tools/cli-client/program'] = './lib/other-program.js';
    write(files.corePackage, JSON.stringify(value));
    assert.throws(() => resolveCliToolchain({ root, pin: makePin() }), /TOOLCHAIN_DEPENDENCY_RESOLUTION_MISMATCH/);
  });
});

test('nested shadow dependency is rejected despite matching top-level package versions', () => {
  withTree(({ root, write, makePin }) => {
    write('@playwright/cli/node_modules/playwright-core/package.json', JSON.stringify({
      name: 'playwright-core', version: '1.64.0-alpha-1790635538000' }));
    assert.throws(() => resolveCliToolchain({ root, pin: makePin() }), /TOOLCHAIN_DEPENDENCY_RESOLUTION_MISMATCH/);
  });
});

test('canonical realpath refuses a dependency link into another owned run', () => {
  withTree(({ root: sibling, makePin: siblingPin }) => {
    const siblingEntryHash = hash(path.join(sibling, files.cliEntry));
    withTree(({ root, makePin, linkDirectory }) => {
      const pin = makePin();
      linkDirectory('@playwright/cli/node_modules/playwright-core', path.join(sibling, 'playwright-core'));
      assert.throws(() => resolveCliToolchain({ root, pin }), /TOOLCHAIN_DEPENDENCY_RESOLUTION_MISMATCH/);
    });
    assert.equal(hash(path.join(sibling, files.cliEntry)), siblingEntryHash);
    assert.equal(resolveCliToolchain({ root: sibling, pin: siblingPin() }).cliExecuted, false);
  });
});

test('malformed package JSON and missing files fail rather than importing a fallback', () => {
  withTree(({ root, write, makePin }) => {
    write(files.cliPackage, '{broken');
    assert.throws(() => resolveCliToolchain({ root, pin: makePin() }), /TOOLCHAIN_PACKAGE_JSON_INVALID/);
  });
  withTree(({ root, makePin }) => {
    const pin = makePin();
    fs.unlinkSync(path.join(root, files.coreBundle));
    assert.throws(() => resolveCliToolchain({ root, pin }), /TOOLCHAIN_FILE_UNAVAILABLE/);
  });
});

test('a sibling run is preserved by exact fixture cleanup', () => {
  withTree(({ root, makePin }) => {
    withTree(({ root: sibling, makePin: siblingPin }) => {
      const before = hash(path.join(root, files.cliEntry));
      assert.equal(resolveCliToolchain({ root: sibling, pin: siblingPin() }).browserStarted, false);
      assert.equal(hash(path.join(root, files.cliEntry)), before);
    });
    assert.equal(resolveCliToolchain({ root, pin: makePin() }).cliExecuted, false);
  });
});
