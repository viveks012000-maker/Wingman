'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { currentGitSha } = require('./process-tools');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');

// Browser/runtime assets only. Backend, migrations, tests, docs and project internals are
// deliberately excluded from the public Netlify artifact.
const PUBLIC_FILES = [
  'index.html',
  'app.html',
  'terms.html',
  'privacy.html',
  'refund.html',
  '404.html',
  'app.js',
  'config.js',
  'accessibility.js',
  'supabaseClient.js',
  'output.css',
  'style.css',
  'robots.txt',
  'sitemap.xml',
  'logo.png',
  'logo-384.webp',
  'maeve.jpg'
];
const PUBLIC_DIRS = ['vendor'];

const FORBIDDEN_TOP_LEVEL = new Set([
  'server.js',
  'database.js',
  'package.json',
  'package-lock.json',
  'input.css',
  'PROMPT_SYSTEM_MEMORY.json',
  'PROJECT_MASTER_SPECIFICATION.md',
  'API_DOCUMENTATION.md',
  'PLAN.md',
  '.env',
  '.env.example',
  '.gitignore',
  '.clineignore'
]);
const FORBIDDEN_PREFIXES = [
  '.git/',
  '.github/',
  'middleware/',
  'migrations/',
  'tests/',
  'config/',
  'utilities/',
  'scripts/',
  'node_modules/'
];

function fail(message) {
  throw new Error(`[netlify-build] ${message}`);
}

function ensureInsideOutput(target) {
  const resolved = path.resolve(target);
  if (resolved !== OUT && !resolved.startsWith(OUT + path.sep)) {
    fail(`Refusing to write outside output directory: ${target}`);
  }
}

function copyFile(rel) {
  const src = path.join(ROOT, rel);
  const dst = path.join(OUT, rel);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) fail(`Required public file is missing: ${rel}`);
  ensureInsideOutput(dst);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDir(rel) {
  const src = path.join(ROOT, rel);
  const dst = path.join(OUT, rel);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) fail(`Required public directory is missing: ${rel}`);
  ensureInsideOutput(dst);
  fs.cpSync(src, dst, { recursive: true, dereference: false });
}

function walk(dir, base = dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) fail(`Symlinks are forbidden in Netlify artifact: ${path.relative(base, full)}`);
    if (entry.isDirectory()) result.push(...walk(full, base));
    else if (entry.isFile()) result.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return result.sort();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeSecurityFiles() {
  const railway = 'https://wingman-production-c6ce.up.railway.app';
  // The new HEIC runtime (heic-to-csp.js) is built with USE_UNSAFE_EVAL=0 and contains no eval/new Function.
  // No unsafe-eval is needed in the CSP.
  function cspFor(allowEval = false) {
    const evalSource = allowEval ? " 'unsafe-eval'" : '';
    return [
    "default-src 'self' https://*.supabase.co",
      `script-src 'self' 'unsafe-inline'${evalSource} https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.supabase.co`,
    "script-src-elem 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.supabase.co",
    "script-src-attr 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co ${railway} https://aicredits.in`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
    ].join('; ') + ';';
  }

  const strictCsp = cspFor(false);
  const appCsp = cspFor(false); // No unsafe-eval needed for new HEIC runtime
  const security = [
    '/*',
    '  Strict-Transport-Security: max-age=31536000',
    '  X-Frame-Options: DENY',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '',
    '/',
    `  Content-Security-Policy: ${strictCsp}`,
    '  Cache-Control: no-cache, no-store, must-revalidate',
    '/index.html',
    `  Content-Security-Policy: ${strictCsp}`,
    '  Cache-Control: no-cache, no-store, must-revalidate',
    '/app',
    `  Content-Security-Policy: ${appCsp}`,
    '  X-Robots-Tag: noindex, nofollow, noarchive',
    '  Cache-Control: no-cache, no-store, must-revalidate',
    '/app.html',
    `  Content-Security-Policy: ${appCsp}`,
    '  X-Robots-Tag: noindex, nofollow, noarchive',
    '  Cache-Control: no-cache, no-store, must-revalidate',
    '/terms.html',
    `  Content-Security-Policy: ${strictCsp}`,
    '  Cache-Control: no-cache, no-store, must-revalidate',
    '/privacy.html',
    `  Content-Security-Policy: ${strictCsp}`,
    '  Cache-Control: no-cache, no-store, must-revalidate',
    '/refund.html',
    `  Content-Security-Policy: ${strictCsp}`,
    '  Cache-Control: no-cache, no-store, must-revalidate',
    '/404.html',
    `  Content-Security-Policy: ${strictCsp}`,
    '  X-Robots-Tag: noindex, nofollow',
    '  Cache-Control: no-cache, no-store, must-revalidate',
    '/app.js',
    '  Cache-Control: no-cache, must-revalidate',
    '/config.js',
    '  Cache-Control: no-cache, must-revalidate',
    '/accessibility.js',
    '  Cache-Control: no-cache, must-revalidate',
    '/supabaseClient.js',
    '  Cache-Control: no-cache, must-revalidate',
    '/output.css',
    '  Cache-Control: no-cache, must-revalidate',
    '/style.css',
    '  Cache-Control: no-cache, must-revalidate',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(OUT, '_headers'), security, 'utf8');

  fs.writeFileSync(path.join(OUT, '_redirects'), '# Cloudflare Pages handles clean HTML URLs natively; no /app rewrite is required.\n', 'utf8');
}

function stripDevelopmentCspSources() {
  for (const rel of PUBLIC_FILES.filter(file => file.endsWith('.html'))) {
    const target = path.join(OUT, rel);
    const source = fs.readFileSync(target, 'utf8');
    const production = source.replace(/\s+http:\/\/localhost:\*/g, '')
      .replace(/\s+ws:\/\/localhost:\*/g, '')
      .replace(/\s+http:\/\/\*:\*/g, '')
      .replace(/\s+ws:\/\/\*:\*/g, '')
      .replace(/\s+https:\/\/\*:\*/g, '')
      .replace(/\s+wss:\/\/\*:\*/g, '');
    fs.writeFileSync(target, production, 'utf8');
  }
}

function verifyNoForbiddenFiles() {
  const files = walk(OUT);
  for (const rel of files) {
    if (FORBIDDEN_TOP_LEVEL.has(rel)) fail(`Forbidden file entered public artifact: ${rel}`);
    if (FORBIDDEN_PREFIXES.some(prefix => rel.startsWith(prefix))) fail(`Forbidden path entered public artifact: ${rel}`);
    if (/\.(sql|md|sqlite|db|ps1|bat|vbs)$/i.test(rel)) fail(`Internal file type entered public artifact: ${rel}`);
  }
  return files;
}

function verifyCriticalRuntimeContent() {
  const appHtml = fs.readFileSync(path.join(OUT, 'app.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(OUT, 'app.js'), 'utf8');
  const config = fs.readFileSync(path.join(OUT, 'config.js'), 'utf8');
  const headers = fs.readFileSync(path.join(OUT, '_headers'), 'utf8');

  const railway = 'https://wingman-production-c6ce.up.railway.app';
  if (!appHtml.includes(railway)) fail('app.html CSP does not include Railway backend');
  if (!config.includes(`API_BASE_URL: "${railway}"`)) fail('config.js does not point to Railway backend');
  if (!headers.includes(railway)) fail('_headers CSP does not include Railway backend');
  if (!headers.includes('Strict-Transport-Security: max-age=31536000')) fail('_headers does not enforce HSTS');
  const unsafeEvalHeaderCount = (headers.match(/'unsafe-eval'/g) || []).length;
  if (unsafeEvalHeaderCount !== 0) fail(`unsafe-eval must not appear in any CSP block with the new HEIC runtime; found ${unsafeEvalHeaderCount}`);
    if (!appHtml.includes('vendor/heic2any-loader.js')) fail('Dashboard HEIC loader must be present');
    if (!fs.existsSync(path.join(OUT, 'vendor', 'heic2any-adapter.js'))) fail('Dashboard HEIC adapter must be present');

  // Prevent the known stale-production regression from ever entering a new artifact.
  if (appJs.includes("if (response.status === 401) {\n                        window.updateUICredits(0);")) {
    fail('Known 401 -> fake zero-credit regression is present');
  }
  if (!appJs.includes('const freshCreditCheck = await window.checkCreditBalance();')) {
    fail('Fresh authoritative balance guard is absent');
  }
  if (!appJs.includes('const authoritativeBalanceCheck = await window.checkCreditBalance();')) {
    fail('HTTP 402 authoritative wallet re-check is absent');
  }

  for (const rel of PUBLIC_FILES.filter(file => file.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(OUT, rel), 'utf8');
    if (html.includes('http://localhost:*') || html.includes('ws://localhost:*') ||
      html.includes('http://*:*') || html.includes('ws://*:*') ||
      html.includes('https://*:*') || html.includes('wss://*:*')) {
      fail(`Development CSP source entered production artifact: ${rel}`);
    }
  }
}

function verifyLocalHtmlReferences() {
  const htmlFiles = PUBLIC_FILES.filter(f => f.endsWith('.html'));
  const missing = [];
  for (const rel of htmlFiles) {
    const text = fs.readFileSync(path.join(OUT, rel), 'utf8');
    const re = /\b(?:src|href)\s*=\s*["']([^"'#?]+)["']/gi;
    let m;
    while ((m = re.exec(text))) {
      let ref = m[1].trim();
      if (!ref || /^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(ref)) continue;
      if (ref.startsWith('//')) continue;
      ref = ref.replace(/^\//, '');
      if (!ref || ref.endsWith('/')) continue;
      const target = path.join(OUT, ref);
      if (!fs.existsSync(target)) missing.push(`${rel} -> ${m[1]}`);
    }
  }
  if (missing.length) fail(`Missing local browser assets:\n${missing.join('\n')}`);
}

function writeManifest(files) {
  const sha = currentGitSha(ROOT);
  const manifest = {
    build: 'frontend-only-netlify',
    sourceCommit: sha,
    generatedAt: new Date().toISOString(),
    files: Object.fromEntries(files.concat(['_headers', '_redirects']).sort().map(rel => [rel, sha256(path.join(OUT, rel))]))
  };
  fs.writeFileSync(path.join(OUT, 'release.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const rel of PUBLIC_FILES) copyFile(rel);
for (const rel of PUBLIC_DIRS) copyDir(rel);
writeSecurityFiles();
stripDevelopmentCspSources();
const files = verifyNoForbiddenFiles();
verifyCriticalRuntimeContent();
verifyLocalHtmlReferences();
writeManifest(files);

const finalFiles = walk(OUT);
console.log(`[netlify-build] Safe frontend artifact created: ${path.relative(ROOT, OUT)}`);
console.log(`[netlify-build] Source commit: ${currentGitSha(ROOT)}`);
console.log(`[netlify-build] Public files: ${finalFiles.length}`);
for (const rel of finalFiles) console.log(`[netlify-build] PUBLIC ${rel}`);
