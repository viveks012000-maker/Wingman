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
const material = require('../scripts/postprocess-self-host-material-symbols');

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
    'scripts/postprocess-self-host-main-fonts.js',
    'scripts/postprocess-self-host-material-symbols.js'
  ]) execFileSync(process.execPath, [script], { cwd: ROOT, stdio: 'pipe' });
}

function verifyArtifact() {
  const font = path.join(OUT, material.FONT_REL);
  const license = path.join(OUT, material.LICENSE_REL);
  assert(fs.existsSync(font), 'pinned Material Symbols subset font must exist in final artifact');
  assert(fs.existsSync(license), 'Material Symbols Apache license must exist in final artifact');
  assert.strictEqual(fs.statSync(font).size, 16580, 'Material Symbols font byte count must stay pinned');
  assert.strictEqual(sha256(font), '56f6255b1341a07abae9b27ad468ecbf7de7141c6522a078060fb4c5173def70', 'Material Symbols font SHA-256 must stay pinned');
  assert.strictEqual(fs.statSync(license).size, 11558, 'Material Symbols license byte count must stay pinned');
  assert.strictEqual(sha256(license), '49bbe9114e49214df2ccc324cb3ac8d1d1aa1c3a0947f94c286765e86647b32e', 'Material Symbols license SHA-256 must stay pinned');
  assert(fs.readFileSync(license, 'utf8').includes('Apache License'), 'Material Symbols license must remain Apache License');

  assert.strictEqual(material.ICON_NAMES.split(',').length, 45, 'self-hosted subset contract must stay at the proven 45 icons unless intentionally regenerated');
  assert(material.LOCAL_CSS.includes("font-weight: 100 700;"), 'variable weight range must be preserved');
  assert(material.LOCAL_CSS.includes('font-display: block;'), 'font-display:block must be preserved to prevent ligature text flash');
  assert(material.LOCAL_CSS.includes("-webkit-font-feature-settings: 'liga';"), 'ligature behavior must be preserved');
  assert(!/fonts\.(?:googleapis|gstatic)\.com/i.test(material.LOCAL_CSS), 'local Material Symbols CSS must have no external font host');

  for (const target of material.TARGETS) {
    const file = path.join(OUT, target);
    const html = fs.readFileSync(file, 'utf8');
    assert.strictEqual((html.match(new RegExp(material.INLINE_MARKER, 'g')) || []).length, 1, `${target} must contain exactly one local Material Symbols style`);
    assert(html.includes(material.LOCAL_CSS), `${target} must inline the deterministic local Material Symbols CSS`);
    assert(!/fonts\.googleapis\.com/i.test(html), `${target} must contain no obsolete Google Fonts stylesheet/CSP host`);
    assert(!/fonts\.gstatic\.com/i.test(html), `${target} must contain no obsolete gstatic font/CSP host`);
  }

  const headersPath = path.join(OUT, '_headers');
  const headers = fs.readFileSync(headersPath, 'utf8');
  assert(!/fonts\.googleapis\.com/i.test(headers), 'final _headers CSP must not allow obsolete Google Fonts stylesheet host');
  assert(!/fonts\.gstatic\.com/i.test(headers), 'final _headers CSP must not allow obsolete Google Fonts asset host');
  assert(headers.includes("style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com"), 'style-src must preserve non-font CSS policy while removing Google Fonts');
  assert(headers.includes("font-src 'self' data:"), 'font-src must become local/data only after all fonts are self-hosted');

  const release = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
  assert.strictEqual(release.files[material.FONT_REL], sha256(font), 'release manifest must hash pinned Material Symbols font');
  assert.strictEqual(release.files[material.LICENSE_REL], sha256(license), 'release manifest must hash Material Symbols license');
  for (const target of material.TARGETS) assert.strictEqual(release.files[target], sha256(path.join(OUT, target)), `release manifest must hash final ${target}`);
  assert.strictEqual(release.files['_headers'], sha256(headersPath), 'release manifest must hash tightened final _headers');
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.woff2')) return 'font/woff2';
  if (file.endsWith('.webp')) return 'image/webp';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

async function withServer(run) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let pathname = url.pathname;
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/app') pathname = '/app.html';
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
  try {
    const address = server.address();
    await run({ base: `http://127.0.0.1:${address.port}`, hits });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function verifyBrowserDelivery() {
  await withServer(async ({ base, hits }) => {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const route of ['/', '/app']) {
        const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
        const page = await context.newPage();
        const externalMaterial = [];
        const errors = [];
        page.on('request', request => {
          const url = request.url();
          if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(url)) externalMaterial.push(url);
        });
        page.on('pageerror', error => errors.push(String(error)));
        await page.route('https://**/*', routeRequest => routeRequest.abort());

        const response = await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 15000 });
        assert(response && response.status() === 200, `${route} artifact must load`);
        const fontLoaded = await page.evaluate(async () => {
          await document.fonts.load("24px 'Material Symbols Outlined'");
          return document.fonts.check("24px 'Material Symbols Outlined'");
        });
        assert(fontLoaded, `${route} must load the local Material Symbols font`);

        const probe = await page.evaluate(() => {
          const wrapper = document.createElement('div');
          const el = document.createElement('span');
          el.className = 'material-symbols-outlined';
          el.textContent = 'home';
          wrapper.appendChild(el);
          document.body.appendChild(wrapper);
          const cs = getComputedStyle(el);
          const out = {
            family: cs.fontFamily,
            display: cs.display,
            lineHeight: cs.lineHeight,
            width: el.getBoundingClientRect().width,
            overflow: document.documentElement.scrollWidth - window.innerWidth
          };
          wrapper.remove();
          return out;
        });
        assert(probe.family.includes('Material Symbols Outlined'), `${route} icon must resolve to Material Symbols font`);
        assert.strictEqual(probe.display, 'inline-block', `${route} icon display semantics must be preserved`);
        assert(probe.width > 0 && probe.width < 100, `${route} rendered icon width must be plausible`);
        assert(probe.overflow <= 1, `${route} must not introduce horizontal overflow`);
        assert.strictEqual(externalMaterial.length, 0, `${route} must make zero external Google font requests`);
        assert.strictEqual(errors.length, 0, `${route} must have zero page errors: ${errors.join('; ')}`);
        await context.close();
      }
      assert(hits.filter(hit => hit === `/${material.FONT_REL}`).length >= 2, 'local Material Symbols font must be requested by both landing and app browser checks');
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
    console.log('✅ Material Symbols 45-icon subset is self-hosted with exact pinned font/license bytes.');
    console.log('✅ Chromium loads the local icon font on landing and app with zero external Google font requests; obsolete Google Fonts CSP origins are removed.');
  } finally {
    fs.rmSync(OUT, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
