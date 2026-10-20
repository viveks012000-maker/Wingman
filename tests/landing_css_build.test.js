'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const SCREENSHOTS = path.join(ROOT, 'work', 'performance-optimization', 'screenshots');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

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
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.jpg': 'image/jpeg'
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

async function main() {
  execSync('npm run build:production', { cwd: ROOT, stdio: 'pipe' });

  const indexPath = path.join(OUT, 'index.html');
  const appPath = path.join(OUT, 'app.html');
  const landingCssPath = path.join(OUT, 'landing-output.css');
  const workspaceCssPath = path.join(OUT, 'output.css');
  const index = fs.readFileSync(indexPath, 'utf8');
  const app = fs.readFileSync(appPath, 'utf8');
  const landingCss = fs.readFileSync(landingCssPath);
  const workspaceCss = fs.readFileSync(workspaceCssPath);
  const completeCustomCss = fs.readFileSync(path.join(OUT, 'style.css'), 'utf8');
  const customStyleTag = '<style data-inline-source="style.css">';
  const landingStyleTag = '<style data-inline-source="landing-output.css">';
  const customStyleStart = index.indexOf(customStyleTag);
  const customStyleEnd = index.indexOf('</style>', customStyleStart);
  const landingStyleStart = index.indexOf(landingStyleTag);
  const landingStyleEnd = index.indexOf('</style>', landingStyleStart);
  assert(customStyleStart >= 0 && customStyleEnd > customStyleStart, 'homepage must contain its scoped inlined custom stylesheet');
  assert(landingStyleStart >= 0 && landingStyleEnd > landingStyleStart, 'homepage must contain its inlined page-specific stylesheet');
  const candidateCustomCss = index.slice(customStyleStart + customStyleTag.length, customStyleEnd).trim();
  const candidateLandingCss = index.slice(landingStyleStart + landingStyleTag.length, landingStyleEnd).trim();
  const release = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));

  assert(candidateCustomCss.length < completeCustomCss.length, 'homepage must inline fewer custom CSS rules than the shared app stylesheet');
  assert(!/\.app-page(?=[\s.#:[>+~]|$)/.test(candidateCustomCss), 'homepage inline CSS must exclude rules scoped to the authenticated app');
  assert.strictEqual((index.match(/rel="preload"[^>]+geist-normal-latin\.woff2/g) || []).length, 1, 'homepage must preload the measured LCP font exactly once');
  assert.strictEqual(candidateLandingCss, landingCss.toString('utf8'), 'homepage inline CSS must match the generated, isolated landing stylesheet byte-for-byte');
  assert(index.indexOf(landingStyleTag) > index.indexOf('name="viewport"'), 'page CSS must follow the viewport declaration');
  assert(index.indexOf(landingStyleTag) < index.indexOf('application/ld+json'), 'page CSS must be discovered before noncritical structured data');

  assert(!/href="\/?output\.css"/.test(index), 'homepage must not load the shared workspace stylesheet');
  assert(!/href="\/?landing-output\.css"/.test(index), 'homepage must not make a separate landing stylesheet request');
  assert(!/href="\/?style\.css"/.test(index), 'homepage must not make a second custom stylesheet request');
  assert.strictEqual((index.match(/data-inline-source="style\.css"/g) || []).length, 1, 'existing custom overrides must remain in the homepage cascade');
  const appCssMarker = '<style data-inline-source="output.css">';
  const appCssStart = app.indexOf(appCssMarker);
  const appCssEnd = app.indexOf('</style>', appCssStart);
  assert(appCssStart >= 0 && appCssEnd > appCssStart, 'authenticated workspace must inline its locked stylesheet');
  assert.strictEqual(app.slice(appCssStart + appCssMarker.length, appCssEnd).trim(), workspaceCss.toString('utf8'), 'app inline stylesheet must match output.css byte-for-byte');
  assert(!/href="\.?\/?output\.css"/.test(app), 'authenticated workspace must not request output.css separately');
  assert.strictEqual((app.match(/href="\/fonts\/plus-jakarta-sans-normal-latin\.woff2"/g) || []).length, 1, 'app must preload the first-view text font exactly once');
  assert.strictEqual((app.match(/href="\/fonts\/material-symbols-outlined-subset\.woff2"/g) || []).length, 1, 'app must preload the first-view icon font exactly once');
  assert.strictEqual(landingCss.length < workspaceCss.length * 0.75, true, 'homepage CSS must be materially smaller than the shared app stylesheet');
  assert(landingCss.toString('utf8').includes('.scroll-reveal{opacity:0;'), 'production scroll-reveal styles must be preserved');
  assert.strictEqual(sha256(workspaceCssPath), 'f513634da85c3b6248efedb2a70605d10552cb251e73bfccd0b3b5dc6af87f56', 'locked workspace CSS must remain byte-identical');
  assert.strictEqual(release.files['landing-output.css'], sha256(landingCssPath), 'release manifest must hash the generated homepage stylesheet');
  assert.strictEqual(release.files['index.html'], sha256(indexPath), 'release manifest must hash the rewritten homepage');
  assert.strictEqual(release.files['app.html'], sha256(appPath), 'release manifest must hash the rewritten workspace page');
  assert(fs.readFileSync(path.join(OUT, '_headers'), 'utf8').includes('/landing-output.css'), 'landing CSS must have an explicit cache policy');

  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/baseline') {
      let baselineHtml = fs.readFileSync(indexPath, 'utf8');
      const landingCssStart = baselineHtml.indexOf(landingStyleTag);
      const landingCssEnd = baselineHtml.indexOf('</style>', landingCssStart);
      assert(landingCssStart >= 0 && landingCssEnd > landingCssStart, 'candidate homepage must contain its inlined landing stylesheet');
      baselineHtml = baselineHtml.slice(0, landingCssStart) + '<link rel="stylesheet" href="output.css">' + baselineHtml.slice(landingCssEnd + '</style>'.length);
      baselineHtml = baselineHtml.replace(/<link rel="preload" href="\/fonts\/geist-normal-latin\.woff2" as="font" type="font\/woff2" crossorigin>\s*/g, '');
      const markerStart = baselineHtml.indexOf(customStyleTag);
      const markerEnd = baselineHtml.indexOf('</style>', markerStart);
      assert(markerStart >= 0 && markerEnd > markerStart, 'baseline homepage must preserve its original custom style marker');
      baselineHtml = `${baselineHtml.slice(0, markerStart + customStyleTag.length)}\n${completeCustomCss}\n${baselineHtml.slice(markerEnd)}`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(baselineHtml);
      return;
    }
    if (pathname === '/index.html') {
      res.writeHead(301, { Location: '/' }).end();
      return;
    }
    if (pathname.endsWith('.html')) {
      res.writeHead(301, { Location: pathname.slice(0, -5) || '/' }).end();
      return;
    }
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/app') pathname = '/app.html';
    if (!path.extname(pathname)) {
      const htmlPage = path.resolve(OUT, `.${pathname}.html`);
      if (htmlPage.startsWith(OUT + path.sep) && fs.existsSync(htmlPage) && fs.statSync(htmlPage).isFile()) pathname += '.html';
    }
    const file = path.resolve(OUT, `.${pathname}`);
    if (!file.startsWith(OUT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(file), 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const baselinePage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const candidateRequests = [];
    page.on('request', request => candidateRequests.push(request.url()));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const baselineResponse = await baselinePage.goto(origin + '/baseline', { waitUntil: 'domcontentloaded' });
    assert.strictEqual(response.status(), 200, 'homepage must load in the production artifact');
    assert.strictEqual(baselineResponse.status(), 200, 'full-size CSS baseline must load from the same artifact');
    await page.waitForFunction(() => Boolean(document.querySelector('style[data-inline-source="landing-output.css"]')?.sheet));
    await baselinePage.waitForFunction(() => {
      const link = document.querySelector('link[rel="stylesheet"]');
      return Boolean(link && link.sheet);
    });
    await page.evaluate(() => document.fonts.load('700 10px Geist'));
    assert.strictEqual(candidateRequests.filter(url => /\/fonts\/geist-normal-latin\.woff2(?:\?|$)/.test(url)).length, 1, 'the preload must satisfy the visible Geist face without a duplicate request');
    assert.strictEqual(candidateRequests.filter(url => /\/(?:landing-)?output\.css(?:\?|$)/.test(url)).length, 0, 'homepage must not fetch either stylesheet separately');
    assert(await page.locator('#hero-reveal-container h1').isVisible(), 'homepage H1 must remain visible');
    for (const route of ['/screenshot-reply', '/icebreaker-generator', '/dating-bio-optimizer', '/ai-conversation-coach']) {
      assert.strictEqual(await page.locator(`a[href="${route}"]`).count(), 1, `homepage must link to ${route}`);
    }
    await page.screenshot({ path: path.join(SCREENSHOTS, 'homepage-css-candidate-desktop.png'), fullPage: true });

    for (const width of [320, 390, 412, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await baselinePage.setViewportSize({ width, height: 844 });
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      assert(dimensions.document <= width && dimensions.body <= width, `homepage must not overflow at ${width}px: ${JSON.stringify(dimensions)}`);
      assert(await page.locator('#hero-reveal-container h1').isVisible(), `homepage H1 must stay visible at ${width}px`);
      for (const surface of [page, baselinePage]) {
        for (const section of await surface.locator('.scroll-reveal').all()) {
          await section.scrollIntoViewIfNeeded();
          await surface.waitForFunction(element => element.classList.contains('reveal-active'), await section.elementHandle(), { timeout: 5000 });
        }
        await surface.evaluate(() => window.scrollTo(0, 0));
        await surface.evaluate(() => {
          for (const animation of document.getAnimations()) {
            animation.pause();
            animation.currentTime = 0;
          }
        });
      }
      const styleProperties = ['display', 'position', 'width', 'height', 'minHeight', 'maxHeight', 'margin', 'padding', 'gap', 'gridTemplateColumns', 'flexDirection', 'alignItems', 'justifyContent', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'backgroundColor', 'borderColor', 'borderRadius', 'boxShadow', 'opacity', 'transform', 'visibility', 'overflow', 'textAlign'];
      const computedStyle = surface => surface.evaluate(properties => {
        return [...document.querySelectorAll('body, body *')].map((element, index) => {
          const style = getComputedStyle(element);
          return [index, element.tagName, element.id, typeof element.className === 'string' ? element.className : '', ...properties.map(property => style[property])];
        });
      }, styleProperties);
      const [baselineStyles, candidateStyles] = await Promise.all([computedStyle(baselinePage), computedStyle(page)]);
      const styleDifferences = [];
      if (baselineStyles.length !== candidateStyles.length) styleDifferences.push(`node count ${baselineStyles.length} vs ${candidateStyles.length}`);
      for (let index = 0; index < Math.min(baselineStyles.length, candidateStyles.length); index++) {
        if (JSON.stringify(baselineStyles[index]) !== JSON.stringify(candidateStyles[index])) {
          const properties = styleProperties.filter((property, propertyIndex) => baselineStyles[index][propertyIndex + 4] !== candidateStyles[index][propertyIndex + 4]);
          styleDifferences.push(`node ${index}: ${JSON.stringify({ element: baselineStyles[index].slice(0, 4), properties: properties.map(property => ({ property, baseline: baselineStyles[index][styleProperties.indexOf(property) + 4], candidate: candidateStyles[index][styleProperties.indexOf(property) + 4] })) })}`);
          if (styleDifferences.length >= 5) break;
        }
      }
      assert.deepStrictEqual(styleDifferences, [], `isolated CSS must preserve the existing homepage styles at ${width}px: ${JSON.stringify(styleDifferences)}`);
      if (width === 412) await page.screenshot({ path: path.join(SCREENSHOTS, 'homepage-css-candidate-mobile.png'), fullPage: true });
    }
    assert.deepStrictEqual(errors, [], 'homepage must have no browser runtime errors');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobile-menu-btn').click();
    assert.strictEqual(await page.locator('#mobile-menu-btn').getAttribute('aria-expanded'), 'true', 'homepage mobile menu must still open');
    await page.locator('#mobileMenu a[href="#pricing"]').click();
    assert.strictEqual(await page.locator('#mobile-menu-btn').getAttribute('aria-expanded'), 'false', 'homepage mobile menu must still close after a link');
    await page.close();
    await baselinePage.close();

    console.log(`✔ Homepage CSS isolation passed (${landingCss.length} bytes vs ${workspaceCss.length} bytes); responsive rendering and mobile navigation remain functional.`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
