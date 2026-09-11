'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');

const genericProviderStart = source.indexOf('async function executeSingleOpenRouterCall');
const analyzerProviderStart = source.indexOf('async function queryAnalyzerProvider');
const maeveProviderStart = source.indexOf('async function queryMaeveProvider');
assert(genericProviderStart >= 0 && analyzerProviderStart > genericProviderStart && maeveProviderStart > analyzerProviderStart);

const genericProvider = source.slice(genericProviderStart, analyzerProviderStart);
const analyzerProvider = source.slice(analyzerProviderStart, maeveProviderStart);

for (const block of [genericProvider, analyzerProvider]) {
  assert(!block.includes('await response.text()'), 'provider error handling must not retain raw upstream bodies');
  assert(!block.includes('JSON.stringify(data)'), 'provider diagnostics must not serialize raw upstream JSON');
  assert(!block.includes('data.error.message'), 'provider diagnostics must not copy upstream error text');
}

assert(source.includes("raw OCR content is intentionally not logged."), 'analyzer debug output must not print extracted screenshot text');
assert(!source.includes('console.log(extractedTextContext)'), 'raw extracted screenshot text must never be logged');

console.log('PROVIDER ERROR LOG SAFETY: ALL TESTS PASSED');
