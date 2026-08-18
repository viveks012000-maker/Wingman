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
    'scripts/postprocess-deferred-runtime.js'
  ]) {
    execFileSync(process.execPath, [script], { cwd: ROOT, stdio: 'pipe' });
  }
}

function verifyArtifactMarkup() {
  const index = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(OUT, 'app.html'), 'utf8');

  for (const src of ['config.js', 'vendor/supabase.min.js', 'supabaseClient.js', 'accessibility.js']) {
    assert(index.includes(`<script defer src="${src}"></script>`), `index.html must defer ${src}`);
    assert(!index.includes(`<script src="${src}"></script>`), `index.html must not parser-block on ${src}`);
  }

  for (const src of ['./vendor/cropperjs/cropper.min.js', 'config.js', 'vendor/supabase.min.js', 'supabaseClient.js', 'app.js', 'accessibility.js']) {
    assert(app.includes(`<script defer src="${src}"></script>`), `app.html must defer ${src}`);
    assert(!app.includes(`<script src="${src}"></script>`), `app.html must not parser-block on ${src}`);
  }

  assert(app.includes('<script src="./vendor/heic2any-loader.js"></script>'), 'tiny HEIC compatibility loader must remain available');

  const indexOrder = ['config.js', 'vendor/supabase.min.js', 'supabaseClient.js', 'accessibility.js'].map(src => index.indexOf(`src="${src}"`));
  const appOrder = ['./vendor/cropperjs/cropper.min.js', 'config.js', 'vendor/supabase.min.js', 'supabaseClient.js', 'app.js', 'accessibility.js'].map(src => app.indexOf(`src="${src}"`));
  assert(indexOrder.every((value, i) => value >= 0 && (i === 0 || value > indexOrder[i - 1])), 'landing deferred dependency order must be preserved');
  assert(appOrder.every((value, i) => value >= 0 && (i === 0 || value > appOrder[i - 1])), 'dashboard deferred dependency order must be preserved');

  const release = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
  assert.strictEqual(release.files['index.html'], sha256(path.join(OUT, 'index.html')), 'release manifest must hash deferred index.html');
  assert.strictEqual(release.files['app.html'], sha256(path.join(OUT, 'app.html')), 'release manifest must hash deferred app.html');
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

async function withServer(run) {
  let delayedStarted = false;
  let delayedFinished = false;
  const server = http.createServer((req, res) => {
    let pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/app') pathname = '/app.html';
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.resolve(OUT, rel);
    if (!file.startsWith(OUT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }

    const send = () => {
      res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(file));
      if (rel === 'vendor/supabase.min.js') delayedFinished = true;
    };

    if (rel === 'vendor/supabase.min.js') {
      delayedStarted = true;
      setTimeout(send, 1500);
    } else {
      send();
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run({
      base: `http://127.0.0.1:${address.port}`,
      state: () => ({ delayedStarted, delayedFinished }),
      resetDelayState: () => { delayedStarted = false; delayedFinished = false; }
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for delayed Supabase request');
}

async function verifyRealBrowserNonBlocking() {
  await withServer(async ({ base, state, resetDelayState }) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const cases = [
        {
          path: '/',
          bodySelector: '#hero-reveal-container',
          runtimeReady: () => typeof window.loginUser === 'function' && typeof window.signInWithGoogle === 'function' && !!(window.supabaseClient && window.supabaseClient.auth)
        },
        {
          path: '/app',
          bodySelector: '#analyzeSection',
          runtimeReady: () => typeof window.checkCreditBalance === 'function' && typeof window.getSupabaseAuthHeaders === 'function' && !!(window.supabaseClient && window.supabaseClient.auth)
        }
      ];

      for (const testCase of cases) {
        resetDelayState();
        const context = await browser.newContext();
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
        await page.route('https://fonts.gstatic.com/**', route => route.abort());

        await page.goto(base + testCase.path, { waitUntil: 'commit', timeout: 10000 });
        await waitFor(() => state().delayedStarted, 2500);
        assert.strictEqual(state().delayedFinished, false, 'Supabase SDK must still be intentionally delayed during parser check');

        await page.waitForTimeout(200);
        const bodyParsedWhileSdkPending = await page.evaluate(selector => !!document.querySelector(selector), testCase.bodySelector);
        assert.strictEqual(bodyParsedWhileSdkPending, true, `${testCase.path} body must parse while the delayed Supabase SDK is still pending`);
        assert.strictEqual(state().delayedFinished, false, `${testCase.path} parser check must occur before delayed SDK response completes`);

        await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
        await page.waitForFunction(testCase.runtimeReady, null, { timeout: 5000 });
        await page.waitForTimeout(100);
        assert.deepStrictEqual(pageErrors, [], `${testCase.path} must boot with zero page errors after deferred execution`);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
}

(async () => {
  try {
    buildArtifact();
    verifyArtifactMarkup();
    await verifyRealBrowserNonBlocking();
    console.log('✅ Production runtime scripts preserve dependency order and no longer block HTML parsing.');
  } finally {
    fs.rmSync(OUT, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
