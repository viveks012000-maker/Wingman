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

  const appDeferredScripts = [
    './vendor/cropperjs/cropper.min.js',
    './vendor/heic2any-loader.js',
    'config.js',
    'vendor/supabase.min.js',
    'supabaseClient.js',
    'app.js',
    'accessibility.js'
  ];
  for (const src of appDeferredScripts) {
    assert(app.includes(`<script defer src="${src}"></script>`), `app.html must defer ${src}`);
    assert(!app.includes(`<script src="${src}"></script>`), `app.html must not parser-block on ${src}`);
  }

  assert(!app.includes('<script src="./vendor/heic2any.min.js"></script>'), 'real HEIC runtime must remain lazy');

  const indexOrder = ['config.js', 'vendor/supabase.min.js', 'supabaseClient.js', 'accessibility.js'].map(src => index.indexOf(`src="${src}"`));
  const appOrder = appDeferredScripts.map(src => app.indexOf(`src="${src}"`));
  assert(indexOrder.every((value, i) => value >= 0 && (i === 0 || value > indexOrder[i - 1])), 'landing deferred dependency order must be preserved');
  assert(appOrder.every((value, i) => value >= 0 && (i === 0 || value > appOrder[i - 1])), 'dashboard deferred dependency/document order must be preserved');

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
  if (file.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

async function withServer(run) {
  let supabaseStarted = false;
  let supabaseFinished = false;
  let heicLoaderStarted = false;
  let heicLoaderFinished = false;

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
      if (rel === 'vendor/supabase.min.js') supabaseFinished = true;
      if (rel === 'vendor/heic2any-loader.js') heicLoaderFinished = true;
    };

    if (rel === 'vendor/supabase.min.js') {
      supabaseStarted = true;
      setTimeout(send, 1500);
    } else if (rel === 'vendor/heic2any-loader.js') {
      heicLoaderStarted = true;
      setTimeout(send, 1200);
    } else {
      send();
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run({
      base: `http://127.0.0.1:${address.port}`,
      state: () => ({ supabaseStarted, supabaseFinished, heicLoaderStarted, heicLoaderFinished }),
      resetDelayState: () => {
        supabaseStarted = false;
        supabaseFinished = false;
        heicLoaderStarted = false;
        heicLoaderFinished = false;
      }
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
  throw new Error('Timed out waiting for delayed runtime request');
}

async function verifyRealBrowserNonBlocking() {
  await withServer(async ({ base, state, resetDelayState }) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const cases = [
        {
          path: '/',
          bodySelector: '#hero-reveal-container',
          expectHeicLoader: false,
          runtimeReady: () => typeof window.loginUser === 'function' && typeof window.signInWithGoogle === 'function' && !!(window.supabaseClient && window.supabaseClient.auth)
        },
        {
          path: '/app',
          bodySelector: '#analyzeSection',
          expectHeicLoader: true,
          runtimeReady: () => typeof window.checkCreditBalance === 'function' && typeof window.getSupabaseAuthHeaders === 'function' && typeof window.heic2any === 'function' && !!(window.supabaseClient && window.supabaseClient.auth)
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
        await waitFor(() => state().supabaseStarted, 2500);
        assert.strictEqual(state().supabaseFinished, false, 'Supabase SDK must still be intentionally delayed during parser check');

        if (testCase.expectHeicLoader) {
          await waitFor(() => state().heicLoaderStarted, 2500);
          assert.strictEqual(state().heicLoaderFinished, false, 'HEIC compatibility loader must still be delayed during parser check');
        } else {
          assert.strictEqual(state().heicLoaderStarted, false, 'landing page must not request the dashboard-only HEIC loader');
        }

        await page.waitForTimeout(200);
        const bodyParsedWhileRuntimePending = await page.evaluate(selector => !!document.querySelector(selector), testCase.bodySelector);
        assert.strictEqual(bodyParsedWhileRuntimePending, true, `${testCase.path} body must parse while delayed runtime scripts are still pending`);
        assert.strictEqual(state().supabaseFinished, false, `${testCase.path} parser check must occur before delayed SDK response completes`);
        if (testCase.expectHeicLoader) {
          assert.strictEqual(state().heicLoaderFinished, false, `${testCase.path} parser check must occur before delayed HEIC loader completes`);
        }

        await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
        await page.waitForFunction(testCase.runtimeReady, null, { timeout: 5000 });
        await page.waitForTimeout(100);
        assert.deepStrictEqual(pageErrors, [], `${testCase.path} must boot with zero page errors after deferred execution`);

        if (testCase.expectHeicLoader) {
                  const realHeicRuntimeRequested = await page.evaluate(() => performance.getEntriesByType('resource').some(entry => /\/vendor\/heic-runtime\/heic-to-csp\.js(?:\?|$)/.test(entry.name)));
                  assert.strictEqual(realHeicRuntimeRequested, false, 'normal dashboard boot must not request the real HEIC runtime');
                }
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
    console.log('✅ Production runtime scripts preserve dependency order and no longer block HTML parsing, including the HEIC compatibility loader.');
  } finally {
    fs.rmSync(OUT, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
