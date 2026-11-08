const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runBrowserCode } = require('./sj-browser-code-file');

async function withDirectory(run) {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'sj-browser-code-test-'));
  const owned = new Set();
  try {
    await run(out, owned);
  } finally {
    // Only exact test-owned fixture files are removed; never recurse or glob.
    for (const filename of owned) {
      await fs.unlink(filename).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
    await fs.rmdir(out);
  }
}

test('file transport preserves quotes and newlines, returns result, and cleans its exact file', async () => {
  await withDirectory(async (out) => {
    const source = `async(page)=>{\n  const text = "single ' double \\\" dollar $ and newline\\n";\n  return page.evaluate(() => /["').,]+$/.test('x'));\n}`;
    let received;
    const result = await runBrowserCode({ out, source, execute: async (filename) => {
      received = filename;
      assert.equal(path.dirname(filename), await fs.realpath(out));
      assert.match(path.basename(filename), /^sj-browser-code-[0-9a-f-]+\.js$/);
      assert.equal(await fs.readFile(filename, 'utf8'), source);
      const stat = await fs.stat(filename);
      if (process.platform !== 'win32') assert.equal(stat.mode & 0o777, 0o600);
      return { measured: true };
    } });
    assert.deepEqual(result, { measured: true });
    await assert.rejects(fs.stat(received), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(out), []);
  });
});

test('execution failure still cleans the owned file and preserves the execution error', async () => {
  await withDirectory(async (out) => {
    const failure = new Error('isolated callback failure');
    await assert.rejects(runBrowserCode({ out, source: 'async(page)=>{}', execute: async () => {
      throw failure;
    } }), (error) => error === failure);
    assert.deepEqual(await fs.readdir(out), []);
  });
});

test('invalid source, statements, and multiple expressions are rejected before file creation', async () => {
  await withDirectory(async (out) => {
    for (const source of ['async(page)=>{', 'async(page)=>{ bad syntax }',
      'async(page)=>{}; globalThis.changed = true;',
      'async(page)=>{}, () => {}', 'async(page)=>{}, second = () => {}']) {
      let called = false;
      await assert.rejects(runBrowserCode({ out, source, execute: async () => { called = true; } }));
      assert.equal(called, false);
      assert.deepEqual(await fs.readdir(out), []);
    }
  });
});

test('compilation never executes the browser function body', async () => {
  await withDirectory(async (out) => {
    const key = 'sjBrowserCodeMustNotExecute';
    assert.equal(globalThis[key], undefined);
    await runBrowserCode({ out, source: `async(page)=>{globalThis.${key}=true;throw new Error('must not run');}`,
      execute: async () => 'transport only' });
    assert.equal(globalThis[key], undefined);
  });
});

test('foreign evidence files remain untouched on success and failure', async () => {
  await withDirectory(async (out, owned) => {
    const foreign = path.join(out, 'existing-evidence.txt');
    owned.add(foreign);
    await fs.writeFile(foreign, 'retain exact evidence', { flag: 'wx' });
    const identity = await fs.stat(foreign);
    for (const fail of [false, true]) {
      const promise = runBrowserCode({ out, source: 'async(page)=>{}', execute: async () => {
        if (fail) throw new Error('callback failure');
      } });
      if (fail) await assert.rejects(promise, /callback failure/);
      else await promise;
      assert.deepEqual(await fs.readdir(out), ['existing-evidence.txt']);
      assert.equal(await fs.readFile(foreign, 'utf8'), 'retain exact evidence');
      const current = await fs.stat(foreign);
      assert.equal(current.dev, identity.dev);
      assert.equal(current.ino, identity.ino);
    }
  });
});

test('cleanup refuses changed contents even when the inode remains the same', async () => {
  await withDirectory(async (out, owned) => {
    let changed;
    await assert.rejects(runBrowserCode({ out, source: 'async(page)=>{}', execute: async (filename) => {
      changed = filename;
      owned.add(filename);
      await fs.writeFile(filename, 'replacement evidence');
    } }), /cleanup refused: file ownership changed/);
    assert.equal(await fs.readFile(changed, 'utf8'), 'replacement evidence');
  });
});

test('cleanup refuses an exact-path replacement and leaves both files intact', async () => {
  await withDirectory(async (out, owned) => {
    const moved = path.join(out, 'retained-owned-source.js');
    owned.add(moved);
    let replaced;
    await assert.rejects(runBrowserCode({ out, source: 'async(page)=>{}', execute: async (filename) => {
      replaced = filename;
      owned.add(filename);
      await fs.rename(filename, moved);
      await fs.writeFile(filename, 'foreign replacement', { flag: 'wx' });
    } }), /cleanup refused: file ownership changed/);
    assert.equal(await fs.readFile(replaced, 'utf8'), 'foreign replacement');
    assert.equal(await fs.readFile(moved, 'utf8'), 'async(page)=>{}');
  });
});

test('relative, missing, file targets and invalid callbacks are rejected without writes', async () => {
  await withDirectory(async (out, owned) => {
    const file = path.join(out, 'not-a-directory.txt');
    owned.add(file);
    await fs.writeFile(file, 'retain', { flag: 'wx' });
    const source = 'async(page)=>{}';
    const execute = async () => assert.fail('must not execute');
    for (const target of ['relative-evidence', path.join(out, 'missing'), file]) {
      await assert.rejects(runBrowserCode({ out: target, source, execute }));
    }
    await assert.rejects(runBrowserCode({ out, source, execute: null }), /callback is required/);
    assert.deepEqual(await fs.readdir(out), ['not-a-directory.txt']);
    assert.equal(await fs.readFile(file, 'utf8'), 'retain');
  });
});
