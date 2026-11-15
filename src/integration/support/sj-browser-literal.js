'use strict';

// Values become data literals in generated instrumentation, never source.
// Escape HTML delimiters and Unicode line separators too so the same literal
// cannot accidentally terminate an HTML script context if a consumer changes.
function browserStringLiteral(value) {
  if (typeof value !== 'string') throw new TypeError('Browser literal must be a string.');
  const escapes = { '<': '\\u003c', '>': '\\u003e', '\u2028': '\\u2028', '\u2029': '\\u2029' };
  return JSON.stringify(value).replace(/[<>\u2028\u2029]/g, character => escapes[character]);
}

module.exports = { browserStringLiteral };
