'use strict';
// Read-only browser prerequisite resolution. No CLI/browser execution, download,
// service start or resource mutation. Browser-only and performance share pins,
// but selecting those pins never enables a performance workload.
const assert = require('node:assert/strict');
const {resolveCliToolchain} = require('./sj-browser-toolchain');
const {resolveTestBrowserSelection} = require('./sj-browser-selection');

function resolveBrowserRunConfig({browser, performance, env}, dependencies = {
  resolveCliToolchain, resolveTestBrowserSelection,
}) {
  assert.equal(typeof browser, 'boolean');
  assert.equal(typeof performance, 'boolean');
  if (performance && !browser) throw Error('PERFORMANCE_REQUIRES_BROWSER_RUN');
  const selectedKeys = ['SJ_TEST_PLAYWRIGHT_CLI_ROOT','SJ_TEST_PLAYWRIGHT_CLI_PIN','SJ_TEST_BROWSER_PROOF'];
  if (!browser) {
    if (selectedKeys.some(key => env[key] !== undefined)) throw Error('EXPLICIT_BROWSER_REQUIRES_BROWSER_RUN');
    return {browserToolchain:null, browserSelection:null};
  }
  if (typeof env.SJ_TEST_PLAYWRIGHT_CLI_ROOT !== 'string' || !env.SJ_TEST_PLAYWRIGHT_CLI_ROOT ||
      typeof env.SJ_TEST_PLAYWRIGHT_CLI_PIN !== 'string' || !env.SJ_TEST_PLAYWRIGHT_CLI_PIN)
    throw Error('PINNED_BROWSER_TOOLCHAIN_REQUIRED');
  let pin;
  try { pin = JSON.parse(env.SJ_TEST_PLAYWRIGHT_CLI_PIN); }
  catch { throw Error('BROWSER_TOOLCHAIN_PIN_INVALID_JSON'); }
  const browserToolchain = {root:env.SJ_TEST_PLAYWRIGHT_CLI_ROOT, pin};
  dependencies.resolveCliToolchain(browserToolchain);
  const browserSelection = dependencies.resolveTestBrowserSelection(env.SJ_TEST_BROWSER_PROOF);
  return {browserToolchain, browserSelection};
}

module.exports = {resolveBrowserRunConfig};
