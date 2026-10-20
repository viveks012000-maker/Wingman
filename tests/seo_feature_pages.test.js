'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pageSpecs = [
  { file: 'screenshot-reply.html', slug: 'screenshot-reply', tool: 'screenshot', intent: /screenshot|chat image/i },
  { file: 'icebreaker-generator.html', slug: 'icebreaker-generator', tool: 'icebreaker', intent: /icebreaker|opening.message/i },
  { file: 'dating-bio-optimizer.html', slug: 'dating-bio-optimizer', tool: 'bio', intent: /bio|profile/i },
  { file: 'ai-conversation-coach.html', slug: 'ai-conversation-coach', tool: 'coach', intent: /Maeve|conversation practice/i }
];

const home = read('index.html');
const sitemap = read('sitemap.xml');
const robots = read('robots.txt');
const app = read('app.html');
const appJs = read('app.js');
const build = read(path.join('scripts', 'build-netlify-dist.js'));
const sharedCss = read('feature-pages.css');
const titles = new Set();

for (const { file, slug, tool, intent } of pageSpecs) {
  const html = read(file);
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const description = head.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1] || '';
  const canonical = 'https://mywingmanapp.com/' + slug;

  assert(title, file + ' must have a title');
  assert(!titles.has(title), file + ' title must be unique');
  titles.add(title);
  assert(description.length >= 50 && description.length <= 200, file + ' must have a concise unique description');
  assert(head.includes('<link rel="canonical" href="' + canonical + '" />'), file + ' must self-canonicalize');
  assert(head.includes('<meta property="og:url" content="' + canonical + '" />'), file + ' Open Graph URL must match its canonical');
  assert(!/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(head), file + ' must remain indexable');
  assert((html.match(/<h1\b/gi) || []).length === 1, file + ' must have exactly one H1');
  assert(intent.test(html), file + ' content must match its distinct feature intent');
  assert(!/<script\b(?![^>]*type=["']application\/ld\+json["'])/i.test(html), file + ' must not load a JavaScript runtime');
  assert(/<link\s+rel="stylesheet"\s+href="\/feature-pages\.css"/i.test(head), file + ' must use the lightweight local stylesheet');
  assert(!/https?:\/\/[^"']+\.(?:css|js)(?:[?#"']|$)/i.test(head), file + ' must not depend on external CSS or JavaScript');
  assert(html.includes('/app?tool=' + tool), file + ' must link directly to its app feature');
  assert(html.includes('href="/privacy"'), file + ' must provide a privacy-policy link');
  assert(html.includes('aria-label="Breadcrumb"'), file + ' must have a visible semantic breadcrumb');

  const jsonLdScripts = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  assert.strictEqual(jsonLdScripts.length, 1, file + ' must have one JSON-LD data block');
  const graph = JSON.parse(jsonLdScripts[0][1])['@graph'];
  assert(graph.some(node => node['@type'] === 'WebPage' && node.url === canonical), file + ' WebPage data must match its canonical URL');
  assert(graph.some(node => node['@type'] === 'BreadcrumbList'), file + ' must describe its breadcrumb');

  const route = '/' + slug;
  assert(build.includes("'" + route + "',"), file + ' must receive a route header block');
  assert(build.includes("'" + file + "'"), file + ' must be included in the public build allowlist');
  assert(build.includes("'" + route + '.html ' + route + " 301'"), file + ' .html alias must redirect to the clean URL');
  assert(sitemap.includes('<loc>' + canonical + '</loc>'), file + ' must be listed in the sitemap');
  assert(!robots.includes('Disallow: ' + route), file + ' must not be blocked from crawling');
}

for (const from of pageSpecs) {
  for (const to of pageSpecs) {
    if (from === to) continue;
    assert(read(from.file).includes('href="/' + to.slug + '"'), from.file + ' must link to ' + to.file);
  }
  assert(home.includes('href="/' + from.slug + '"'), 'homepage must link to ' + from.file);
}

const toolTargets = {
  screenshot: 'analyzeSection',
  icebreaker: 'icebreakSection',
  bio: 'optimizeSection',
  coach: 'chatboxSection'
};
for (const [tool, tab] of Object.entries(toolTargets)) {
  assert(appJs.includes(tool + ': "' + tab + '"'), 'workspace deep link must map ' + tool + ' to the correct tab');
}
assert(sharedCss.includes('@media (max-width: 740px)'), 'feature page styles must include a mobile layout');
assert(sharedCss.includes('@media (prefers-reduced-motion: reduce)'), 'feature page styles must honor reduced motion');

console.log('✅ Four public feature pages have distinct metadata and content, valid JSON-LD, direct app links, internal links, and crawlable clean URLs.');
