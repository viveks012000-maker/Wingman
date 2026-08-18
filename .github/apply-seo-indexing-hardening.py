from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path, old, new):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one anchor, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# Landing canonical and share metadata. Canonical host is the verified production Pages host;
# mywingman.com currently redirects to unrelated yourwingman.com content.
index_desc = '''    <meta name="description"\n        content="MyWingman: Turn stale dating app chats into real-world dates with intelligent chat screenshot recommendations tailored to your match's messaging style." />'''
index_meta = index_desc + '''\n    <link rel="canonical" href="https://mywingman.pages.dev/" />\n    <meta property="og:type" content="website" />\n    <meta property="og:site_name" content="MyWingman" />\n    <meta property="og:title" content="MyWingman - Upload Chat Screenshots. Get Better Responses. Meet In Real Life." />\n    <meta property="og:description" content="Turn stale dating app chats into real-world dates with intelligent chat screenshot recommendations tailored to your match's messaging style." />\n    <meta property="og:url" content="https://mywingman.pages.dev/" />\n    <meta property="og:image" content="https://mywingman.pages.dev/logo.png" />\n    <meta property="og:image:alt" content="MyWingman" />\n    <meta name="twitter:card" content="summary" />\n    <meta name="twitter:title" content="MyWingman - Upload Chat Screenshots. Get Better Responses. Meet In Real Life." />\n    <meta name="twitter:description" content="Turn stale dating app chats into real-world dates with intelligent chat screenshot recommendations tailored to your match's messaging style." />\n    <meta name="twitter:image" content="https://mywingman.pages.dev/logo.png" />'''
replace_once('index.html', index_desc, index_meta)

# Dashboard is a user workspace/login surface, not search content. Keep it crawlable so noindex
# can be seen; do not robots.txt-disallow it.
app_desc = '    <meta name="description" content="MyWingman Dashboard Tool: Upload chat screenshots for instant reply breakdown, icebreaker generation, and conversation optimization."/>'
replace_once('app.html', app_desc, app_desc + '\n    <meta name="robots" content="noindex, nofollow, noarchive"/>')

# 404 remains noindex and gains a document-level CSP that does not allow JavaScript at all.
robots404 = '  <meta name="robots" content="noindex, nofollow">'
csp404 = robots404 + '\n  <meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'none\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; font-src \'self\' data:; connect-src \'none\'; object-src \'none\'; base-uri \'self\'; form-action \'self\'; worker-src \'none\';">'
replace_once('404.html', robots404, csp404)

# Canonical crawler files must point at the actual MyWingman production host.
robots = (ROOT / 'robots.txt').read_text(encoding='utf-8')
if 'https://mywingman.com/sitemap.xml' not in robots:
    raise SystemExit('robots.txt: old canonical sitemap anchor missing')
(ROOT / 'robots.txt').write_text(robots.replace('https://mywingman.com/sitemap.xml', 'https://mywingman.pages.dev/sitemap.xml'), encoding='utf-8')

sitemap = (ROOT / 'sitemap.xml').read_text(encoding='utf-8')
if sitemap.count('https://mywingman.com') != 4:
    raise SystemExit(f'sitemap.xml: expected four old canonical host entries, found {sitemap.count("https://mywingman.com")}')
(ROOT / 'sitemap.xml').write_text(sitemap.replace('https://mywingman.com', 'https://mywingman.pages.dev'), encoding='utf-8')

# Defense in depth at the Cloudflare response-header layer for known dashboard/404 paths.
build_path = ROOT / 'scripts' / 'build-netlify-dist.js'
build = build_path.read_text(encoding='utf-8')
app_block = '''    '/app',\n    `  Content-Security-Policy: ${appCsp}`,\n    '  Cache-Control: no-cache, no-store, must-revalidate',\n    '/app.html',\n    `  Content-Security-Policy: ${appCsp}`,\n    '  Cache-Control: no-cache, no-store, must-revalidate','''
app_block_new = '''    '/app',\n    `  Content-Security-Policy: ${appCsp}`,\n    '  X-Robots-Tag: noindex, nofollow, noarchive',\n    '  Cache-Control: no-cache, no-store, must-revalidate',\n    '/app.html',\n    `  Content-Security-Policy: ${appCsp}`,\n    '  X-Robots-Tag: noindex, nofollow, noarchive',\n    '  Cache-Control: no-cache, no-store, must-revalidate','''
if build.count(app_block) != 1:
    raise SystemExit('build script: app header block anchor mismatch')
build = build.replace(app_block, app_block_new, 1)
refund_block = '''    '/refund.html',\n    `  Content-Security-Policy: ${strictCsp}`,\n    '  Cache-Control: no-cache, no-store, must-revalidate',\n    '/app.js','''
refund_block_new = '''    '/refund.html',\n    `  Content-Security-Policy: ${strictCsp}`,\n    '  Cache-Control: no-cache, no-store, must-revalidate',\n    '/404.html',\n    `  Content-Security-Policy: ${strictCsp}`,\n    '  X-Robots-Tag: noindex, nofollow',\n    '  Cache-Control: no-cache, no-store, must-revalidate',\n    '/app.js','''
if build.count(refund_block) != 1:
    raise SystemExit('build script: refund/header anchor mismatch')
build_path.write_text(build.replace(refund_block, refund_block_new, 1), encoding='utf-8')

# Update existing crawler regression to the verified production host.
seo_test = ROOT / 'tests' / 'seo_files.test.js'
seo = seo_test.read_text(encoding='utf-8')
if seo.count('https://mywingman.com') != 5:
    raise SystemExit(f'seo_files.test.js: expected five old host assertions, found {seo.count("https://mywingman.com")}')
seo_test.write_text(seo.replace('https://mywingman.com', 'https://mywingman.pages.dev'), encoding='utf-8')

# Add an explicit metadata/indexing/security regression guard.
metadata_test = r'''\'use strict\';

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
'''
metadata_test = metadata_test.replace("r'''\\'use strict\\';", "'use strict';") if False else metadata_test
# The raw triple-quoted string begins with an escaped quote only to keep this bootstrap readable.
if metadata_test.startswith("\\'use strict\\';"):
    metadata_test = "'use strict';" + metadata_test[len("\\'use strict\\';"):]
(ROOT / 'tests' / 'seo_indexing_metadata.test.js').write_text(metadata_test, encoding='utf-8')

# Register the new suite after paid-plan state.
run_path = ROOT / 'tests' / 'run_all_tests.js'
run = run_path.read_text(encoding='utf-8')
anchor = "    { name: '55. Persisted Paid Plan State & O(1) Lookup Guard', file: 'paid_plan_state.test.js' }\n];"
replacement = "    { name: '55. Persisted Paid Plan State & O(1) Lookup Guard', file: 'paid_plan_state.test.js' },\n    { name: '56. SEO Indexing, Canonical Metadata & 404 Hardening', file: 'seo_indexing_metadata.test.js' }\n];"
if run.count(anchor) != 1:
    raise SystemExit('run_all_tests.js: suite registration anchor mismatch')
run_path.write_text(run.replace(anchor, replacement, 1), encoding='utf-8')

print('SEO/indexing hardening patch applied successfully.')
