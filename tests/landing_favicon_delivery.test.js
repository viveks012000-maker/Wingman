'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');
const { runNpmScript } = require('../scripts/process-tools');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const ICO_PATH = '/favicon.ico';
const PNGS = [
  ['/favicon-48x48.png', 48],
  ['/favicon-96x96.png', 96],
  ['/favicon-192x192.png', 192],
  ['/apple-touch-icon.png', 180]
];
const ASSETS = [...PNGS.map(([url]) => url.slice(1)), 'favicon.ico'];
const HTML_FILES = [
  'index.html', 'app.html', 'privacy.html', 'terms.html', 'refund.html',
  'about.html', 'contact.html', 'service-delivery.html', '404.html'
];
const FAVICON_LINKS = [
  '<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png" />',
  '<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png" />',
  '<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png" />',
  '<link rel="icon" type="image/x-icon" href="/favicon.ico" />',
  '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />'
];

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
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.ico')) return 'image/x-icon';
  if (file.endsWith('.xml')) return 'application/xml';
  if (file.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function readPngDimensions(input) {
  const file = Buffer.isBuffer(input) ? 'Embedded ICO image' : input;
  const data = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  assert(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), file + ' must be a valid PNG.');
  assert.strictEqual(data.toString('ascii', 12, 16), 'IHDR', file + ' must contain a PNG IHDR header.');
  assert.strictEqual(data[25], 2, file + ' must use opaque RGB pixels, not transparency.');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function paethPredictor(left, above, upperLeft) {
  const p = left + above - upperLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - above);
  const pc = Math.abs(p - upperLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return above;
  return upperLeft;
}

function readPngRgbPixels(input) {
  const file = Buffer.isBuffer(input) ? 'Embedded ICO image' : input;
  const data = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const dimensions = readPngDimensions(data);
  const chunks = [];
  let offset = 8;
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(data.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  const bytesPerPixel = 3;
  const rowBytes = dimensions.width * bytesPerPixel;
  const stride = rowBytes + 1;
  const compressed = zlib.inflateSync(Buffer.concat(chunks));
  assert.strictEqual(compressed.length, stride * dimensions.height, file + ' must decode into complete RGB rows.');
  const pixels = Buffer.alloc(rowBytes * dimensions.height);
  for (let y = 0; y < dimensions.height; y++) {
    const sourceOffset = y * stride;
    const targetOffset = y * rowBytes;
    const filter = compressed[sourceOffset];
    for (let i = 0; i < rowBytes; i++) {
      const raw = compressed[sourceOffset + 1 + i];
      const left = i >= bytesPerPixel ? pixels[targetOffset + i - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[targetOffset + i - rowBytes] : 0;
      const upperLeft = y > 0 && i >= bytesPerPixel ? pixels[targetOffset + i - rowBytes - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paethPredictor(left, above, upperLeft);
      else assert.strictEqual(filter, 0, file + ' uses an unsupported PNG row filter.');
      pixels[targetOffset + i] = (raw + predictor) & 255;
    }
  }
  return { ...dimensions, pixels };
}

function hasInlineFavicon(html) {
  return (html.match(/<link\b[^>]*>/gi) || []).some(tag =>
    /rel=["'][^"']*icon/i.test(tag) && /href=["']data:image\/svg\+xml/i.test(tag));
}

function requestAsGooglebot(server, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath,
      headers: { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' }
    }, res => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] }));
    });
    req.on('error', reject);
  });
}

async function verifyBrowserRendering(server) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: 'light'
    });
    const page = await context.newPage();
    await page.route('https://**/*', route => route.abort());
    const response = await page.goto('http://127.0.0.1:' + server.address().port + '/', {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    assert(response && response.status() === 200, 'Production landing artifact must load successfully.');
    const links = await page.locator('link[rel~="icon"]').evaluateAll(nodes =>
      nodes.map(node => ({ href: node.getAttribute('href'), type: node.getAttribute('type'), sizes: node.getAttribute('sizes') })));
    for (const [url, size] of PNGS.slice(0, 3)) {
      assert(links.some(link => link.href === url && link.sizes === size + 'x' + size), 'Browser document must declare favicon size ' + size + '.');
    }
    assert(links.some(link => link.href === ICO_PATH && link.type === 'image/x-icon'), 'Browser document must declare the ICO fallback.');
    const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    assert.strictEqual(appleIcon, '/apple-touch-icon.png', 'Browser document must declare the Apple touch icon.');
    await context.close();
  } finally {
    await browser.close();
  }
}

(async () => {
  let server;
  try {
    for (const file of HTML_FILES) {
      const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
      for (const link of FAVICON_LINKS) assert(html.includes(link), file + ' must link the stable branded favicon files.');
      assert(!hasInlineFavicon(html), file + ' must not retain the obsolete emoji SVG favicon.');
    }

    buildArtifact();

    for (const [url, size] of PNGS) {
      const file = path.join(OUT, url.slice(1));
      assert.deepStrictEqual(readPngDimensions(file), { width: size, height: size }, file + ' must have square dimensions.');
      const decoded = readPngRgbPixels(file);
      const corners = [
        0,
        (decoded.width - 1) * 3,
        (decoded.height - 1) * decoded.width * 3,
        (decoded.height * decoded.width - 1) * 3
      ].map(offset => [...decoded.pixels.subarray(offset, offset + 3)]);
      assert(corners.every(pixel => pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0),
        url + ' must have opaque pure-black pixels at all four corners.');
      let artworkPixels = 0;
      for (let i = 0; i < decoded.pixels.length; i += 3) {
        if (decoded.pixels[i] || decoded.pixels[i + 1] || decoded.pixels[i + 2]) artworkPixels++;
      }
      assert(artworkPixels > 0, url + ' must contain the colored MyWingman artwork.');
      for (const backdrop of [[255, 255, 255], [0, 0, 0]]) {
        const corner = corners[0];
        const composited = corner.map((channel, index) => Math.round(channel * 1 + backdrop[index] * 0));
        assert.deepStrictEqual(composited, [0, 0, 0], url + ' must retain a black background on light and dark backdrops.');
      }
    }

    const ico = fs.readFileSync(path.join(OUT, 'favicon.ico'));
    assert.strictEqual(ico.readUInt16LE(0), 0, 'ICO reserved header field must be zero.');
    assert.strictEqual(ico.readUInt16LE(2), 1, 'ICO image type must be 1.');
    assert(ico.length <= 8192, 'Multi-resolution ICO should stay compact.');
    const icoCount = ico.readUInt16LE(4);
    assert(icoCount >= 3, 'ICO must include multiple icon resolutions.');
    const icoSizes = [];
    for (let i = 0; i < icoCount; i++) {
      const entryOffset = 6 + i * 16;
      const width = ico[entryOffset] || 256;
      const height = ico[entryOffset + 1] || 256;
      const bytes = ico.readUInt32LE(entryOffset + 8);
      const imageOffset = ico.readUInt32LE(entryOffset + 12);
      const frame = ico.subarray(imageOffset, imageOffset + bytes);
      const decoded = readPngRgbPixels(frame);
      assert.strictEqual(decoded.width, width, 'ICO frame width must match its directory entry.');
      assert.strictEqual(decoded.height, height, 'ICO frame height must match its directory entry.');
      const corners = [
        0,
        (width - 1) * 3,
        (height - 1) * width * 3,
        (height * width - 1) * 3
      ].map(offset => decoded.pixels.subarray(offset, offset + 3));
      assert(corners.every(pixel => pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0),
        'ICO ' + width + 'px frame must use opaque pure-black background pixels.');
      icoSizes.push(width);
    }
    for (const size of [16, 32, 48]) assert(icoSizes.includes(size), 'ICO must include a ' + size + 'px entry.');

    const release = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
    for (const asset of ASSETS) {
      const file = path.join(OUT, asset);
      assert.strictEqual(release.files[asset], sha256(file), 'Release manifest must hash ' + asset + '.');
    }
    const artifactIndex = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
    assert(artifactIndex.includes('href="/favicon-48x48.png"'), 'Final production artifact must reference the public 48px favicon URL.');
    assert(!hasInlineFavicon(artifactIndex), 'Final production artifact must not use the obsolete emoji favicon.');

    const hits = [];
    server = http.createServer((req, res) => {
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

    for (const asset of ASSETS) {
      const result = await requestAsGooglebot(server, '/' + asset);
      assert.strictEqual(result.status, 200, 'Googlebot must be able to fetch /' + asset + '.');
      assert.strictEqual(result.type, contentType(asset), '/' + asset + ' must use its correct image MIME type.');
    }
    await verifyBrowserRendering(server);

    console.log('✅ Favicon PNG/ICO assets are branded, multi-size, opaque black, Googlebot-accessible, and present in the release manifest.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(OUT, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
