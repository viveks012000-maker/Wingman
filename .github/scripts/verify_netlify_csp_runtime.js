'use strict';

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(process.cwd(), 'netlify-dist');
const headersText = fs.readFileSync(path.join(root, '_headers'), 'utf8');
const headerLines = headersText.split(/\r?\n/);

function block(route, required = true) {
  const start = headerLines.indexOf(route);
  if (start < 0) {
    if (required) throw new Error(`missing _headers block ${route}`);
    return {};
  }
  const out = {};
  for (let i = start + 1; i < headerLines.length && /^\s/.test(headerLines[i]); i++) {
    const line = headerLines[i].trim();
    const j = line.indexOf(':');
    if (j > 0) out[line.slice(0, j)] = line.slice(j + 1).trim();
  }
  return out;
}

const strictRoot = block('/')['Content-Security-Policy'];
const strictIndex = block('/index.html')['Content-Security-Policy'];
const appAlias = block('/app')['Content-Security-Policy'];
const appHtml = block('/app.html')['Content-Security-Policy'];
if (!strictRoot || !strictIndex || !appAlias || !appHtml) throw new Error('required CSP blocks missing');
if (strictRoot.includes("'unsafe-eval'") || strictIndex.includes("'unsafe-eval'")) throw new Error('landing CSP unexpectedly allows unsafe-eval');
if (!appAlias.includes("'unsafe-eval'") || !appHtml.includes("'unsafe-eval'")) throw new Error('dashboard CSP missing HEIC compatibility allowance');
for (const route of ['/terms.html', '/privacy.html', '/refund.html']) {
  const csp = block(route)['Content-Security-Policy'];
  if (!csp || csp.includes("'unsafe-eval'")) throw new Error(`${route} CSP must remain eval-free`);
}
if ((headersText.match(/'unsafe-eval'/g) || []).length !== 2) throw new Error('unsafe-eval is not scoped exactly to /app and /app.html');

const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const route = (req.url.split('?')[0] || '/');
  let filePath = route;
  if (route === '/') filePath = '/index.html';
  if (route === '/app') filePath = '/app.html';
  const fp = path.join(root, filePath.replace(/^\//, ''));
  if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.statusCode = 404;
    return res.end('not found');
  }

  // Netlify applies the wildcard block to all resources, plus a more-specific
  // route block when one exists. Static assets need no dedicated route block.
  const merged = { ...block('/*'), ...block(route, false) };
  for (const [k, v] of Object.entries(merged)) res.setHeader(k, v);
  res.setHeader('Content-Type', mime[path.extname(fp)] || 'application/octet-stream');
  fs.createReadStream(fp).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(4195, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  for (const route of ['/', '/index.html', '/app.html', '/app']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:4195${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1300);
    const metaHasUnsafeEval = await page.evaluate(() => {
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      return Boolean(meta && meta.content.includes("'unsafe-eval'"));
    });
    results.push({ route, errors, metaHasUnsafeEval });
    if (errors.length) throw new Error(`${route} page errors: ${errors.join(' | ')}`);
    await page.close();
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.find(x => x.route === '/').metaHasUnsafeEval) throw new Error('root landing meta CSP still allows eval');
  if (results.find(x => x.route === '/index.html').metaHasUnsafeEval) throw new Error('index meta CSP still allows eval');
  if (!results.find(x => x.route === '/app.html').metaHasUnsafeEval) throw new Error('dashboard meta CSP lost HEIC compatibility allowance');
  await browser.close();
  server.close();
})().catch(error => {
  console.error(error);
  server.close();
  process.exit(1);
});
