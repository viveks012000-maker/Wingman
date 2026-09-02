'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const buildScript = fs.readFileSync(path.join(ROOT, 'scripts', 'build-netlify-dist.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

assert.ok(server.includes("'https://mywingman.pages.dev'"), 'Cloudflare production origin must be explicitly allowed by Railway CORS');
assert.ok(server.includes("'https://mywingmanapp.com'"), 'Custom production origin must be explicitly allowed during cutover');
assert.ok(!server.includes("'https://*.pages.dev'"), 'CORS must never allow every pages.dev project');
assert.ok(buildScript.includes("'404.html'"), 'Safe frontend artifact must include a top-level 404.html');
assert.ok(!buildScript.includes("'/app /app.html 200\\n'"), 'Artifact must not generate the Cloudflare /app self-rewrite loop');

try {
  execFileSync(process.execPath, ['scripts/build-netlify-dist.js'], { cwd: ROOT, stdio: 'pipe' });

  const redirects = fs.readFileSync(path.join(OUT, '_redirects'), 'utf8');
  const activeRedirects = redirects.split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#'));
  assert.deepStrictEqual(activeRedirects, [], 'Cloudflare cutover artifact must not contain an active /app rewrite');

  const notFoundPath = path.join(OUT, '404.html');
  assert.ok(fs.existsSync(notFoundPath), 'Top-level 404.html must be emitted for Cloudflare Pages');
  const notFound = fs.readFileSync(notFoundPath, 'utf8');
  assert.ok(/Page not found/i.test(notFound), '404 page must contain a clear not-found message');
  assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|AICREDITS_API_KEY/.test(notFound), '404 page must not reveal secret names');

  const release = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
  assert.ok(release.files && release.files['404.html'], 'release.json must fingerprint 404.html');
  assert.ok(release.files['_redirects'], 'release.json must fingerprint _redirects');

  console.log('✔ Cloudflare Pages cutover guard passed: clean /app routing artifact, real 404 asset, exact CORS origin.');
} finally {
  fs.rmSync(OUT, { recursive: true, force: true });
}
