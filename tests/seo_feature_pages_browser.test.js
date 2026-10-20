'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'netlify-dist');
const screenshotDir = path.join(root, 'work', 'performance-optimization', 'screenshots');
const pages = [
  { route: '/screenshot-reply', file: 'screenshot-reply.html', tool: 'screenshot' },
  { route: '/icebreaker-generator', file: 'icebreaker-generator.html', tool: 'icebreaker' },
  { route: '/dating-bio-optimizer', file: 'dating-bio-optimizer.html', tool: 'bio' },
  { route: '/ai-conversation-coach', file: 'ai-conversation-coach.html', tool: 'coach' }
];

function contentType(file) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

async function main() {
  execFileSync(process.execPath, ['scripts/build-netlify-dist.js'], { cwd: root, stdio: 'pipe' });
  fs.mkdirSync(screenshotDir, { recursive: true });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('.html')) {
      const clean = pathname.replace(/\.html$/, '');
      res.writeHead(301, { Location: clean || '/' });
      res.end();
      return;
    }
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/app') pathname = '/app.html';
    if (!path.extname(pathname)) {
      const cleanPage = path.resolve(output, '.' + pathname + '.html');
      if (cleanPage.startsWith(output + path.sep) && fs.existsSync(cleanPage) && fs.statSync(cleanPage).isFile()) {
        pathname += '.html';
      }
    }
    const diskPath = path.resolve(output, '.' + pathname);
    if (!diskPath.startsWith(output + path.sep) || !fs.existsSync(diskPath) || !fs.statSync(diskPath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(diskPath), 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(diskPath).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const failures = [];

  try {
    for (const item of pages) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('requestfailed', req => failures.push(item.route + ' request failed: ' + req.url()));
      const response = await page.goto(origin + item.route, { waitUntil: 'networkidle' });
      assert.strictEqual(response.status(), 200, item.route + ' must return 200');
      assert(await page.locator('h1').isVisible(), item.route + ' H1 must be visible');
      assert.strictEqual(await page.locator('script:not([type="application/ld+json"])').count(), 0, item.route + ' must not load JavaScript');
      assert.strictEqual(await page.locator('link[rel="stylesheet"]').count(), 1, item.route + ' must use only its shared local stylesheet');
      assert.strictEqual(await page.locator('link[rel="canonical"]').getAttribute('href'), 'https://mywingmanapp.com' + item.route);
      const toolLinks = await page.locator('a[href^="/app?tool="]').evaluateAll(links => links.map(link => link.getAttribute('href')));
      assert(toolLinks.length > 0 && toolLinks.every(href => href === '/app?tool=' + item.tool), item.route + ' app links must target its matching tool');
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(screenshotDir, item.route.slice(1) + '-desktop.png'), fullPage: true });

      for (const width of [320, 390, 412]) {
        await page.setViewportSize({ width, height: 844 });
        const dimensions = await page.evaluate(() => ({
          viewport: innerWidth,
          body: document.body.scrollWidth,
          document: document.documentElement.scrollWidth,
          wideContent: [...document.body.querySelectorAll('*')].map(el => { const css = getComputedStyle(el); return { tag: el.tagName, className: typeof el.className === 'string' ? el.className.slice(0, 60) : '', scroll: el.scrollWidth, client: el.clientWidth, width: css.width, whiteSpace: css.whiteSpace, fontSize: css.fontSize, text: (el.textContent || '').trim().slice(0, 50) }; }).filter(el => el.scroll > el.client + 1).slice(0, 8),
          overflow: [...document.body.querySelectorAll('*')].map(el => {
            const rect = el.getBoundingClientRect();
            return { tag: el.tagName, className: typeof el.className === 'string' ? el.className.slice(0, 60) : '', text: (el.textContent || '').trim().slice(0, 70), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
          }).filter(el => el.right > innerWidth + 1 || el.left < -1).slice(0, 8)
        }));
        assert(dimensions.body <= width && dimensions.document <= width, item.route + ' must not overflow at ' + width + 'px: ' + JSON.stringify(dimensions));
        assert(await page.locator('h1').isVisible(), item.route + ' H1 must stay visible at ' + width + 'px');
        if (width === 412) await page.screenshot({ path: path.join(screenshotDir, item.route.slice(1) + '-mobile.png'), fullPage: true });
      }

      const internalLinks = await page.locator('a[href^="/"]').evaluateAll(links => [...new Set(links.map(link => link.getAttribute('href').split(/[?#]/, 1)[0]))]);
      for (const link of internalLinks) {
        if (!link || link === '/') continue;
        const linked = await page.request.get(origin + link, { maxRedirects: 5 });
        assert.strictEqual(linked.status(), 200, item.route + ' internal link ' + link + ' must resolve to HTTP 200');
      }

      assert.deepStrictEqual(pageErrors, [], item.route + ' must have no runtime errors');
      await page.close();
    }

    const cleanPage = await browser.newPage();
    const alias = await cleanPage.request.get(origin + '/screenshot-reply.html', { maxRedirects: 0 });
    assert.strictEqual(alias.status(), 301, '.html aliases must redirect permanently');
    assert.strictEqual(alias.headers().location, '/screenshot-reply', '.html alias must redirect directly to the clean canonical URL');
    await cleanPage.close();

    assert.deepStrictEqual(failures, [], 'feature pages must load all required assets successfully');
    console.log('✅ Playwright loaded all four public pages; mobile widths 320/390/412 have no overflow, internal links resolve, and clean aliases 301 directly.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
