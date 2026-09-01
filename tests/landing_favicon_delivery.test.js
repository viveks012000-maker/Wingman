'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { runNpmScript } = require('../scripts/process-tools');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const EXPECTED_FAVICON = '<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🦅</text></svg>"/>';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function buildArtifact() {
  fs.rmSync(OUT, { recursive: true, force: true });
  runNpmScript('build:netlify', { cwd: ROOT, stdio: 'pipe' });
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.woff2')) return 'font/woff2';
  if (file.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

async function verifyBrowserDoesNotRequestFallbackFavicon() {
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    hits.push(pathname);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.resolve(OUT, rel);
    if (!file.startsWith(OUT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(file));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
    const page = await context.newPage();
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.route('https://**/*', route => route.abort());
    const response = await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    assert(response && response.status() === 200, 'landing artifact must load successfully');
    await page.waitForTimeout(500);
    const href = await page.locator('link[rel~="icon"]').getAttribute('href');
    assert(href && href.startsWith('data:image/svg+xml,'), 'landing favicon must resolve from an explicit data-SVG link');
    assert(!requests.some(url => /\/favicon\.ico(?:[?#]|$)/i.test(url)), 'Chromium must make zero /favicon.ico requests');
    assert(!hits.some(hit => hit === '/favicon.ico'), 'local server must receive zero /favicon.ico requests');
    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  try {
    const sourceIndex = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const sourceApp = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
    assert.strictEqual((sourceIndex.match(/<link\s+rel="icon"/g) || []).length, 1, 'source landing page must declare exactly one favicon');
    assert(sourceIndex.includes(EXPECTED_FAVICON), 'source landing favicon must exactly match the existing app favicon');
    assert(sourceApp.includes(EXPECTED_FAVICON), 'app favicon contract must remain unchanged');

    buildArtifact();

    const artifactIndexPath = path.join(OUT, 'index.html');
    const artifactIndex = fs.readFileSync(artifactIndexPath, 'utf8');
    assert.strictEqual((artifactIndex.match(/<link\s+rel="icon"/g) || []).length, 1, 'final landing artifact must contain exactly one favicon declaration');
    assert(artifactIndex.includes(EXPECTED_FAVICON), 'final landing artifact must preserve the explicit data-SVG favicon');
    assert(!artifactIndex.includes('href="/favicon.ico"') && !artifactIndex.includes('href="favicon.ico"'), 'final landing artifact must not reference favicon.ico');

    const release = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
    assert.strictEqual(release.files['index.html'], sha256(artifactIndexPath), 'release manifest must hash final favicon-bearing index.html');

    await verifyBrowserDoesNotRequestFallbackFavicon();
    console.log('✅ Landing uses the same explicit data-SVG eagle favicon as app.html.');
    console.log('✅ Chromium makes zero /favicon.ico requests from the strict production artifact.');
  } finally {
    fs.rmSync(OUT, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
