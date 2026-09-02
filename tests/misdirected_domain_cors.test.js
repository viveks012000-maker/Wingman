'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const railway = fs.readFileSync(path.join(root, 'railway-server.js'), 'utf8');
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

console.log('Running misdirected-domain CORS revocation guard...');

for (const [label, source, declaration] of [
  ['inner API', server, 'const productionAllowedOrigins = ['],
  ['Railway admission', railway, 'const GATEWAY_PRODUCTION_ALLOWED_ORIGINS = [']
]) {
  const start = source.indexOf(declaration);
  assert(start >= 0, `${label}: production allowlist declaration missing`);
  const end = source.indexOf('];', start);
  assert(end > start, `${label}: production allowlist terminator missing`);
  const block = source.slice(start, end + 2);
  const originLines = block.split(/\r?\n/).map(line => line.trim());
  assert(originLines.some(line => line === "'https://mywingman.pages.dev'," || line === "'https://mywingman.pages.dev'"), `${label}: verified Pages origin must remain trusted`);
  assert(originLines.some(line => line === "'https://mywingmanapp.com'," || line === "'https://mywingmanapp.com'"), `${label}: verified custom origin must remain trusted during cutover`);
  assert(!block.includes('https://mywingman.com'), `${label}: misdirected domain must not remain a default origin`);
  assert(source.includes("if (origin === 'https://mywingman.com') return false;"), `${label}: stale configured domain must be explicitly rejected in production`);
}

assert.strictEqual(envExample.includes('ALLOWED_ORIGINS="https://mywingman.pages.dev,https://mywingmanapp.com"'), true, 'environment template must trust both verified production origins during cutover');
assert.strictEqual(envExample.includes('https://mywingman.com'), false, 'environment template must not advertise stale domain trust');

console.log('✅ Pages remains trusted while mywingman.com is permanently denied by both production CORS layers.');
