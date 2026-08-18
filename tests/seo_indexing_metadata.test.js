'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const notFound = fs.readFileSync(path.join(root, '404.html'), 'utf8');
const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const build = fs.readFileSync(path.join(root, 'scripts', 'build-netlify-dist.js'), 'utf8');

console.log('Running SEO indexing and metadata hardening guard...');

assert.strictEqual((index.match(/rel="canonical"/g) || []).length, 1, 'Landing must have exactly one canonical link.');
assert(index.includes('<link rel="canonical" href="https://mywingman.pages.dev/" />'), 'Landing canonical must use verified Pages production host.');
assert(index.includes('property="og:type" content="website"'), 'Landing must expose Open Graph type.');
assert(index.includes('property="og:url" content="https://mywingman.pages.dev/"'), 'Open Graph URL must match canonical production host.');
assert(index.includes('property="og:image" content="https://mywingman.pages.dev/logo.png"'), 'Open Graph image must be absolute and production-hosted.');
assert(index.includes('name="twitter:card" content="summary"'), 'Landing must expose Twitter card metadata.');
assert(index.includes('name="twitter:title"'), 'Landing must expose Twitter title metadata.');
assert(index.includes('name="twitter:description"'), 'Landing must expose Twitter description metadata.');
assert(index.includes('name="twitter:image" content="https://mywingman.pages.dev/logo.png"'), 'Twitter image must be absolute and production-hosted.');

assert(app.includes('<meta name="robots" content="noindex, nofollow, noarchive"/>'), 'Dashboard must explicitly opt out of indexing.');
assert(!sitemap.includes('/app'), 'Dashboard must stay out of the sitemap.');
assert(!robots.includes('Disallow: /app'), 'Dashboard must remain crawlable so search engines can observe noindex.');

assert(robots.includes('Sitemap: https://mywingman.pages.dev/sitemap.xml'), 'robots.txt must reference the verified production sitemap.');
assert(!robots.includes('mywingman.com'), 'robots.txt must not point to the unrelated mywingman.com domain.');
assert(!sitemap.includes('https://mywingman.com'), 'sitemap must not advertise the unrelated mywingman.com domain.');
for (const expected of [
  'https://mywingman.pages.dev/',
  'https://mywingman.pages.dev/privacy.html',
  'https://mywingman.pages.dev/terms.html',
  'https://mywingman.pages.dev/refund.html'
]) assert(sitemap.includes(`<loc>${expected}</loc>`), `Sitemap missing ${expected}`);

assert(notFound.includes('name="robots" content="noindex, nofollow"'), '404 document must remain noindex.');
assert(notFound.includes("script-src 'none'"), '404 document CSP must prohibit JavaScript.');
assert(notFound.includes("object-src 'none'"), '404 document CSP must prohibit plugins/objects.');
assert(notFound.includes("connect-src 'none'"), '404 document CSP must prohibit network connections.');

assert(/'\/app',\s*`  Content-Security-Policy: \$\{appCsp\}`,\s*'  X-Robots-Tag: noindex, nofollow, noarchive'/s.test(build), 'Clean /app response must emit X-Robots-Tag noindex.');
assert(/'\/app\.html',\s*`  Content-Security-Policy: \$\{appCsp\}`,\s*'  X-Robots-Tag: noindex, nofollow, noarchive'/s.test(build), '/app.html response must emit X-Robots-Tag noindex.');
assert(/'\/404\.html',\s*`  Content-Security-Policy: \$\{strictCsp\}`,\s*'  X-Robots-Tag: noindex, nofollow'/s.test(build), '/404.html must receive strict CSP and X-Robots-Tag headers.');

console.log('✅ Canonical SEO host, social metadata, dashboard noindex, and 404 hardening are locked to production truth.');
