'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const SOURCE_CSS = path.join(ROOT, 'vendor', 'cropperjs', 'cropper.min.css');
const CSS_FILE = 'vendor/cropperjs/cropper.min.css';
const MARKER = `data-inline-source="${CSS_FILE}"`;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function buildArtifact() {
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const script of [
    'scripts/build-netlify-dist.js',
    'scripts/postprocess-lazy-heic.js',
    'scripts/postprocess-deferred-media.js',
    'scripts/postprocess-vendor-allowlist.js',
    'scripts/postprocess-deferred-runtime.js',
    'scripts/postprocess-material-symbols-subset.js',
    'scripts/postprocess-logo-delivery.js',
    'scripts/postprocess-inline-critical-css.js',
    'scripts/postprocess-inline-cropper-css.js',
    'scripts/postprocess-self-host-main-fonts.js'
  ]) execFileSync(process.execPath, [script], { cwd: ROOT, stdio: 'pipe' });
}

function verifyArtifact() {
  const sourceCss = fs.readFileSync(SOURCE_CSS, 'utf8');
  const artifactCss = path.join(OUT, CSS_FILE);
  const appPath = path.join(OUT, 'app.html');
  const app = fs.readFileSync(appPath, 'utf8');

  assert(sourceCss.trim(), 'Cropper CSS source must not be empty');
  assert(!/<\/style/i.test(sourceCss), 'Cropper CSS must remain safe for exact inline embedding');
  assert(fs.existsSync(artifactCss), 'Cropper CSS asset must remain preserved in the production artifact');
  assert.strictEqual(sha256(artifactCss), sha256(SOURCE_CSS), 'artifact Cropper CSS must remain byte-identical to repository source');
  assert.strictEqual((app.match(new RegExp(MARKER, 'g')) || []).length, 1, 'app.html must contain exactly one inline Cropper marker');
  assert(!/\bhref=(["'])\.\/?vendor\/cropperjs\/cropper\.min\.css\1/i.test(app), 'app.html must not request Cropper CSS as a render-blocking stylesheet');
  assert(app.includes(`<style ${MARKER}>\n${sourceCss}\n</style>`), 'app.html must inline the exact current Cropper CSS bytes without mutation');

  for (const target of ['index.html', '404.html', 'terms.html', 'privacy.html', 'refund.html']) {
    const html = fs.readFileSync(path.join(OUT, target), 'utf8');
    assert(!html.includes(MARKER), `${target} must not receive unrelated Cropper CSS`);
  }

  const release = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
  assert.strictEqual(release.files[CSS_FILE], sha256(artifactCss), 'release manifest must retain the preserved Cropper CSS hash');
  assert.strictEqual(release.files['app.html'], sha256(appPath), 'release manifest must hash final app.html after Cropper CSS inlining');
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.woff2')) return 'font/woff2';
  if (file.endsWith('.webp')) return 'image/webp';
  if (file.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

async function withServer(run) {
  let cropperCssRequests = 0;
  const server = http.createServer((req, res) => {
    let pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/app') pathname = '/app.html';
    if (pathname === '/vendor/cropperjs/cropper.min.css') cropperCssRequests++;
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
  try {
    const address = server.address();
    await run({ base: `http://127.0.0.1:${address.port}`, count: () => cropperCssRequests });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function verifyBrowserDelivery() {
  await withServer(async ({ base, count }) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
      const page = await context.newPage();
      const requested = [];
      const pageErrors = [];
      page.on('request', request => requested.push(request.url()));
      page.on('pageerror', error => pageErrors.push(String(error)));
      await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      await page.route('https://fonts.gstatic.com/**', route => route.abort());

      const response = await page.goto(base + '/app', { waitUntil: 'domcontentloaded', timeout: 15000 });
      assert(response && response.status() === 200, '/app local artifact must load');
      await page.waitForTimeout(250);

      const probe = await page.evaluate(() => {
        const container = document.createElement('div');
        container.className = 'cropper-container';
        const hidden = document.createElement('div');
        hidden.className = 'cropper-hidden';
        container.appendChild(hidden);
        document.body.appendChild(container);
        const containerStyle = getComputedStyle(container);
        const hiddenStyle = getComputedStyle(hidden);
        const result = {
          position: containerStyle.position,
          touchAction: containerStyle.touchAction,
          userSelect: containerStyle.userSelect,
          hiddenDisplay: hiddenStyle.display,
          overflow: document.documentElement.scrollWidth - window.innerWidth
        };
        container.remove();
        return result;
      });

      assert.strictEqual(probe.position, 'relative', 'inlined Cropper CSS must apply container positioning');
      assert.strictEqual(probe.touchAction, 'none', 'inlined Cropper CSS must preserve touch interaction contract');
      assert.strictEqual(probe.userSelect, 'none', 'inlined Cropper CSS must preserve selection behavior');
      assert.strictEqual(probe.hiddenDisplay, 'none', 'inlined Cropper CSS must preserve hidden-state behavior');
      assert(probe.overflow <= 1, 'Cropper CSS inlining must not introduce horizontal overflow');
      assert.strictEqual(pageErrors.length, 0, `browser must have zero page errors: ${pageErrors.join('; ')}`);
      assert(!requested.some(url => /\/vendor\/cropperjs\/cropper\.min\.css(?:\?|$)/.test(url)), 'browser must not request Cropper CSS');
      assert.strictEqual(count(), 0, 'local server must receive zero Cropper CSS HTTP requests');
      await context.close();
    } finally {
      await browser.close();
    }
  });
}

(async () => {
  try {
    buildArtifact();
    verifyArtifact();
    await verifyBrowserDelivery();
    console.log('✅ Cropper.js CSS is inlined byte-for-byte into /app while the vendor asset remains preserved.');
    console.log('✅ Chromium applied Cropper interaction styles with zero Cropper CSS HTTP requests or page errors.');
  } finally {
    fs.rmSync(OUT, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
