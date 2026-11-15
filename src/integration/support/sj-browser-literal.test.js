'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { browserStringLiteral } = require('./sj-browser-literal');

test('generated browser data literals round-trip dangerous delimiters without executing them', () => {
  for (const value of ['C:/owned/"quoted"/\'apostrophe\'/file.png', '</script><script>globalThis.compromised=true</script>',
    'line\nreturn\rnull\0\u2028\u2029', '`); globalThis.compromised=true; //', '\\u003c']) {
    const context = vm.createContext({});
    const literal = browserStringLiteral(value);
    assert.doesNotMatch(literal, /[<>\u2028\u2029]/);
    assert.equal(new vm.Script(literal).runInContext(context), value);
    assert.equal(context.compromised, undefined);
  }
});
test('objects, numbers and coercion hooks cannot supply instrumentation literals', () => {
  for (const value of [null, undefined, 1, {}, {toString(){throw Error('not invoked');}}]) {
    assert.throws(() => browserStringLiteral(value), /must be a string/);
  }
});
