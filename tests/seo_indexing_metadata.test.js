'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const app = read('app.html');
const notFound = read('404.html');
const robots = read('robots.txt');
const sitemap = read('sitemap.xml');
const build = read(path.join('scripts', 'build-netlify-dist.js'));

console.log('Running SEO indexing and metadata hardening guard...');

const faviconLinks = [
  '<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png" />',
  '<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png" />',
  '<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png" />',
  '<link rel="icon" type="image/x-icon" href="/favicon.ico" />',
  '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />'
];

function verifyFaviconLinks(file, html) {
  for (const link of faviconLinks) {
    assert(html.includes(link), file + ' must reference ' + link);
  }
  const hasInlineFavicon = (html.match(/<link\b[^>]*>/gi) || []).some(tag =>
    /rel=["'][^"']*icon/i.test(tag) && /href=["']data:image\/svg\+xml/i.test(tag));
  assert(!hasInlineFavicon, file + ' must not use the obsolete inline emoji favicon');
}

verifyFaviconLinks('index.html', index);
verifyFaviconLinks('app.html', app);
assert.strictEqual((index.match(/rel="canonical"/g) || []).length, 1, 'Landing must have exactly one canonical link.');
assert(index.includes('<link rel="canonical" href="https://mywingmanapp.com/" />'), 'Landing canonical must use the verified production host.');
assert(index.includes('property="og:type" content="website"'), 'Landing must expose Open Graph type.');
assert(index.includes('property="og:url" content="https://mywingmanapp.com/"'), 'Open Graph URL must match canonical host.');
assert(index.includes('property="og:image" content="https://mywingmanapp.com/logo-384.webp"'), 'Open Graph image must be absolute and production-hosted.');
assert(index.includes('name="twitter:card" content="summary"'), 'Landing must expose Twitter card metadata.');
assert(index.includes('name="twitter:title"'), 'Landing must expose Twitter title metadata.');
assert(index.includes('name="twitter:description"'), 'Landing must expose Twitter description metadata.');
assert(index.includes('name="twitter:image" content="https://mywingmanapp.com/logo-384.webp"'), 'Twitter image must be absolute and production-hosted.');

const homeDescription = index.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1] || '';
assert(/chat screenshots/i.test(homeDescription), 'Landing description must describe screenshot reply help.');
assert(/icebreakers/i.test(homeDescription), 'Landing description must describe the icebreaker feature.');
assert(/50 free credits/i.test(homeDescription), 'Landing description must retain the eligible signup offer.');

const publicPages = [
  ['privacy.html', 'privacy'],
  ['terms.html', 'terms'],
  ['refund.html', 'refund'],
  ['about.html', 'about'],
  ['contact.html', 'contact'],
  ['service-delivery.html', 'service-delivery'],
  ['screenshot-reply.html', 'screenshot-reply'],
  ['icebreaker-generator.html', 'icebreaker-generator'],
  ['dating-bio-optimizer.html', 'dating-bio-optimizer'],
  ['ai-conversation-coach.html', 'ai-conversation-coach']
];
const titles = new Set([index.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()]);
const publicPaths = ['https://mywingmanapp.com/'];
for (const [file, slug] of publicPages) {
  const html = read(file);
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  const expectedUrl = 'https://mywingmanapp.com/' + slug;
  verifyFaviconLinks(file, html);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  assert(title, file + ' must have a title.');
  assert(!titles.has(title), file + ' must have a distinctive title.');
  titles.add(title);
  assert(head.includes('<link rel="canonical" href="' + expectedUrl + '" />'), file + ' canonical must use its final clean URL.');
  assert(head.includes('<meta property="og:url" content="' + expectedUrl + '" />'), file + ' Open Graph URL must match its canonical.');
  assert(/<meta\s+name="description"\s+content="[^"]{50,200}"/i.test(head), file + ' must have a useful meta description.');
  assert(!/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(head), file + ' must remain indexable.');
  assert(/<h1\b/i.test(html), file + ' must keep a semantic page heading.');
  publicPaths.push(expectedUrl);
}

assert(app.includes('<meta name="robots" content="noindex, nofollow, noarchive"/>'), 'Dashboard must explicitly opt out of indexing.');
assert(!sitemap.includes('/app'), 'Dashboard must stay out of the sitemap.');
assert(!robots.includes('Disallow: /app'), 'Dashboard must remain crawlable so search engines can observe noindex.');
assert(robots.includes('Sitemap: https://mywingmanapp.com/sitemap.xml'), 'robots.txt must reference the production sitemap.');
assert(!/^\s*noindex:/im.test(robots), 'robots.txt must not contain an unsupported noindex directive.');
assert(!robots.includes('mywingman.com'), 'robots.txt must not point to an unrelated domain.');

const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
assert.strictEqual(sitemapUrls.length, 11, 'Sitemap must list the homepage, six information pages, and four feature pages.');
assert.strictEqual(new Set(sitemapUrls).size, sitemapUrls.length, 'Sitemap URLs must be unique.');
assert.deepStrictEqual(sitemapUrls, publicPaths, 'Sitemap must contain only the final self-canonical public URLs.');
assert(sitemapUrls.every(url => url.startsWith('https://mywingmanapp.com/')), 'Sitemap URLs must use the canonical HTTPS host.');
assert(sitemapUrls.every(url => !/\.html(?:$|[?#])/i.test(url)), 'Sitemap must not include URLs that permanently redirect.');
assert(!sitemap.includes('/api/') && !sitemap.includes('localhost'), 'Sitemap must exclude API and development URLs.');
for (const [source, destination] of [
  ['/index.html', '/'],
  ['/app.html', '/app'],
  ['/privacy.html', '/privacy'],
  ['/terms.html', '/terms'],
  ['/refund.html', '/refund'],
  ['/about.html', '/about'],
  ['/contact.html', '/contact'],
  ['/service-delivery.html', '/service-delivery'],
  ['/screenshot-reply.html', '/screenshot-reply'],
  ['/icebreaker-generator.html', '/icebreaker-generator'],
  ['/dating-bio-optimizer.html', '/dating-bio-optimizer'],
  ['/ai-conversation-coach.html', '/ai-conversation-coach']
]) {
  assert(build.includes("'" + source + ' ' + destination + " 301'"), source + ' must permanently redirect to ' + destination + '.');
}

assert(notFound.includes('name="robots" content="noindex, nofollow"'), '404 document must remain noindex.');
assert(notFound.includes("script-src 'none'"), '404 document CSP must prohibit JavaScript.');
assert(notFound.includes("object-src 'none'"), '404 document CSP must prohibit plugins/objects.');
assert(notFound.includes("connect-src 'none'"), '404 document CSP must prohibit network connections.');
verifyFaviconLinks('404.html', notFound);

const tick = String.fromCharCode(96);
const appCspMarker = tick + '  Content-Security-Policy: ' + '$' + '{appCsp}' + tick;
const strictCspMarker = tick + '  Content-Security-Policy: ' + '$' + '{strictCsp}' + tick;
for (const route of ['/app', '/app.html']) {
  const start = build.indexOf("'" + route + "',");
  assert(start >= 0, route + ' response headers must be declared.');
  const routeHeaders = build.slice(start, start + 220);
  assert(routeHeaders.includes(appCspMarker), route + ' must keep its application CSP header.');
  assert(routeHeaders.includes('X-Robots-Tag: noindex, nofollow, noarchive'), route + ' must emit X-Robots-Tag noindex.');
}
for (const route of ['/terms', '/privacy', '/refund']) {
  const start = build.indexOf("'" + route + "',");
  assert(start >= 0 && build.slice(start, start + 150).includes(strictCspMarker),
    'Clean ' + route + ' response must emit strict CSP.');
}
const notFoundRoute = build.slice(build.indexOf("'/404.html',"), build.indexOf("'/app.js',"));
assert(notFoundRoute.includes(strictCspMarker), '/404.html must keep its strict CSP.');
assert(notFoundRoute.includes('X-Robots-Tag: noindex, nofollow'), '/404.html must receive X-Robots-Tag.');
assert(build.includes("'  Cache-Control: public, max-age=0, must-revalidate'"), 'Versionless static assets must revalidate on repeat requests.');
assert(/'\/robots\.txt',\s*'  Cache-Control: public, max-age=0, must-revalidate'/.test(build), 'robots.txt must revalidate after deployment.');
assert(/'\/sitemap\.xml',\s*'  Cache-Control: public, max-age=0, must-revalidate'/.test(build), 'sitemap.xml must revalidate after deployment.');
assert(/'\/release\.json',\s*'  Cache-Control: public, max-age=0, must-revalidate'/.test(build), 'release metadata must revalidate after deployment.');

console.log('✅ Canonicals, metadata, sitemap URLs, robots directives, favicon links, and noindex protections are consistent.');
