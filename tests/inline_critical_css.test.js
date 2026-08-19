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
const SOURCE_CSS = path.join(ROOT, 'style.css');
const TARGETS = ['index.html', 'app.html', '404.html'];
const MARKER = 'data-inline-source="style.css"';

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
    'scripts/postprocess-inline-critical-css.js'
  ]) {
    execFileSync(process.execPath, [script], { cwd: ROOT, stdio: 'pipe' });
  }
}

function verifyArtifact() {
  const sourceCss = fs.readFileSync(SOURCE_CSS, 'utf8');
  const artifactCss = path.join(OUT, 'style.css');
  assert(sourceCss.trim(), 'style.css source must not be empty');
  assert(!/<\/style/i.test(sourceCss), 'style.css must remain safe for direct inline embedding');
  assert(fs.existsSync(artifactCss), 'style.css source asset must remain preserved in the production artifact');
  assert.strictEqual(sha256(artifactCss), sha256(SOURCE_CSS), 'artifact style.css must remain byte-identical to repository source');

  for (const target of TARGETS) {
    const htmlPath = path.join(OUT, target);
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.strictEqual((html.match(new RegExp(MARKER, 'g')) || []).length, 1, `${target} must contain exactly one inline style.css marker`);
    assert(!/\bhref=(["'])\/?style\.css\1/i.test(html), `${target} must not request style.css as a render-blocking stylesheet`);
    const expectedInline = `<style ${MARKER}>\n${sourceCss}\n</style>`;
    assert(html.includes(expectedInline), `${target} must inline the exact current style.css bytes without mutation`);
  }

  for (const target of ['terms.html', 'privacy.html', 'refund.html']) {
    const html = fs.readFileSync(path.join(OUT, target), 'utf8');
    assert(!html.includes(MARKER), `${target} must not receive unrelated style.css inlining`);
    assert(!/\bhref=(["'])\/?style\.css\1/i.test(html), `${target} must remain free of style.css requests`);
  }

  const release = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
  assert.strictEqual(release.files['style.css'], sha256(artifactCss), 'release manifest must retain the preserved style.css hash');
  for (const target of TARGETS) {
    assert.strictEqual(release.files[target], sha256(path.join(OUT, target)), `release manifest must hash final inlined ${target}`);
  }
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.webp')) return 'image/webp';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

async function withServer(run) {
  let styleRequests = 0;
  const server = http.createServer((req, res) => {
    let pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/app') pathname = '/app.html';
    if (pathname === '/__missing__') pathname = '/404.html';
    if (pathname === '/style.css') styleRequests++;

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
  const address = server.address();
  try {
    await run({ base: `http://127.0.0.1:${address.port}`, getStyleRequests: () => styleRequests });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function verifyBrowserDelivery() {
  await withServer(async ({ base, getStyleRequests }) => {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const routePath of ['/', '/app', '/__missing__']) {
        const context = await browser.newContext({ viewport: { width: 320, height: 900 } });
        const page = await context.newPage();
        const requested = [];
        page.on('request', request => requested.push(request.url()));
        await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
        await page.route('https://fonts.gstatic.com/**', route => route.abort());

        const response = await page.goto(base + routePath, { waitUntil: 'domcontentloaded', timeout: 15000 });
        assert(response && response.status() === 200, `${routePath} local artifact page must load`);
        await page.waitForTimeout(150);

        const probe = await page.evaluate(() => {
          const element = document.createElement('button');
          element.className = 'a11y-icon-touch-target';
          element.textContent = 'probe';
          document.body.appendChild(element);
          const style = getComputedStyle(element);
          const result = {
            minWidth: style.minWidth,
            minHeight: style.minHeight,
            overflow: document.documentElement.scrollWidth - window.innerWidth
          };
          element.remove();
          return result;
        });

        // These dimensions come from style.css and are intentionally not overridden by
        // page-specific inline rules. Some pages do override display:flex later in the
        // cascade, so display is not a valid invariant for proving this stylesheet applied.
        assert.strictEqual(probe.minWidth, '44px', `${routePath} must apply inlined style.css min-width contract`);
        assert.strictEqual(probe.minHeight, '44px', `${routePath} must apply inlined style.css min-height contract`);
        assert(probe.overflow <= 1, `${routePath} must not introduce horizontal overflow`);
        assert(!requested.some(url => /\/style\.css(?:\?|$)/.test(url)), `${routePath} browser must not request style.css`);

        if (routePath === '/') {
          const ambientDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('ambient-plexus-canvas')).display);
          assert.strictEqual(ambientDisplay, 'none', 'mobile landing page must preserve style.css ambient-canvas optimization');
        }
        if (routePath === '/app') {
          const scenarioDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('practiceScenarioBar')).display);
          assert.strictEqual(scenarioDisplay, 'grid', 'mobile dashboard must preserve style.css practice-scenario grid repair');
        }

        await context.close();
      }
      assert.strictEqual(getStyleRequests(), 0, 'local browser verification must make zero style.css HTTP requests');
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
    console.log('✅ Critical style.css is inlined byte-for-byte on /, /app and 404 while the source asset remains preserved.');
    console.log('✅ Chromium applied the inlined mobile/accessibility rules with zero style.css HTTP requests.');
  } finally {
    fs.rmSync(OUT, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
