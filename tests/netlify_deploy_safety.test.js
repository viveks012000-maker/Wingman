'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');

function walk(dir, base = dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full, base));
    else if (entry.isFile()) result.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return result.sort();
}

try {
  execFileSync(process.execPath, ['scripts/build-netlify-dist.js'], { cwd: ROOT, stdio: 'pipe' });

  assert.ok(fs.existsSync(path.join(OUT, 'index.html')), 'index.html must be public');
  assert.ok(fs.existsSync(path.join(OUT, 'app.html')), 'app.html must be public');
  assert.ok(fs.existsSync(path.join(OUT, 'app.js')), 'app.js must be public');
  assert.ok(fs.existsSync(path.join(OUT, 'config.js')), 'config.js must be public');
  assert.ok(fs.existsSync(path.join(OUT, 'supabaseClient.js')), 'supabaseClient.js must be public');
  assert.ok(fs.existsSync(path.join(OUT, '_headers')), 'Netlify security headers must be generated');
  assert.ok(fs.existsSync(path.join(OUT, 'release.json')), 'release manifest must be generated');

  const files = walk(OUT);
  const forbidden = files.filter(rel =>
    rel === 'server.js' ||
    rel === 'database.js' ||
    rel === 'package.json' ||
    rel === 'package-lock.json' ||
    rel.startsWith('middleware/') ||
    rel.startsWith('migrations/') ||
    rel.startsWith('tests/') ||
    rel.startsWith('config/') ||
    rel.startsWith('utilities/') ||
    rel.startsWith('.github/') ||
    /\.(?:sql|md|sqlite|db|ps1|bat|vbs)$/i.test(rel)
  );
  assert.deepStrictEqual(forbidden, [], `Public Netlify artifact contains forbidden files: ${forbidden.join(', ')}`);

  const railway = 'https://wingman-production-c6ce.up.railway.app';
  const appHtml = fs.readFileSync(path.join(OUT, 'app.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(OUT, 'app.js'), 'utf8');
  const configJs = fs.readFileSync(path.join(OUT, 'config.js'), 'utf8');
  const headers = fs.readFileSync(path.join(OUT, '_headers'), 'utf8');

  const headerBlock = (route) => {
    const lines = headers.split(/\r?\n/);
    const start = lines.indexOf(route);
    assert.ok(start >= 0, `Missing _headers route block: ${route}`);
    const body = [];
    for (let i = start + 1; i < lines.length && /^\s/.test(lines[i]); i++) body.push(lines[i].trim());
    return body.join('\n');
  };

  assert.ok(appHtml.includes(railway), 'app.html CSP must permit Railway');
  assert.ok(configJs.includes(`API_BASE_URL: "${railway}"`), 'config.js must target Railway');
  assert.ok(headers.includes(railway), 'HTTP CSP must permit Railway');
  assert.ok(headerBlock('/*').includes('Strict-Transport-Security: max-age=31536000'), 'All frontend routes must enforce HSTS');
  assert.ok(!headerBlock('/').includes("'unsafe-eval'"), 'Root landing CSP must not allow unsafe-eval');
  assert.ok(!headerBlock('/index.html').includes("'unsafe-eval'"), 'index.html CSP must not allow unsafe-eval');
  assert.ok(!headerBlock('/app').includes("'unsafe-eval'"), '/app CSP must not allow unsafe-eval (new HEIC runtime uses USE_UNSAFE_EVAL=0)');
  assert.ok(!headerBlock('/app.html').includes("'unsafe-eval'"), 'app.html CSP must not allow unsafe-eval (new HEIC runtime uses USE_UNSAFE_EVAL=0)');
  for (const route of ['/terms.html', '/privacy.html', '/refund.html']) assert.ok(!headerBlock(route).includes("'unsafe-eval'"), `${route} CSP must remain eval-free`);
  assert.strictEqual((headers.match(/'unsafe-eval'/g) || []).length, 0, 'unsafe-eval must not appear in any CSP block');
  assert.ok(!appJs.includes("if (response.status === 401) {\n                        window.updateUICredits(0);"), '401 must never become fake zero credits');
  assert.ok(appJs.includes('const freshCreditCheck = await window.checkCreditBalance();'), 'low client balance must be freshly rechecked');
  assert.ok(appJs.includes('const authoritativeBalanceCheck = await window.checkCreditBalance();'), 'HTTP 402 must recheck authoritative wallet');

  const release = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
  assert.strictEqual(release.build, 'frontend-only-netlify');
  assert.ok(typeof release.sourceCommit === 'string' && release.sourceCommit.length > 0);
  assert.ok(release.files && release.files['app.html'] && release.files['app.js']);

  console.log(`✔ Netlify deploy safety passed (${files.length} public files, zero backend/internal files).`);
} finally {
  fs.rmSync(OUT, { recursive: true, force: true });
}
