'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const OPTIMIZED_LOGO = 'logo-384.webp';

const TARGETS = Object.freeze([
  { file: 'index.html', direct: 2, fallback: 1 },
  { file: 'app.html', direct: 3, fallback: 0 },
  { file: 'terms.html', direct: 1, fallback: 0 },
  { file: 'privacy.html', direct: 1, fallback: 0 },
  { file: 'refund.html', direct: 1, fallback: 0 },
  { file: '404.html', direct: 1, fallback: 0 }
]);

function fail(message) {
  throw new Error(`[logo-delivery] ${message}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function countMatches(source, regex) {
  return [...source.matchAll(regex)].length;
}

function rewriteHtml(target) {
  const file = path.join(OUT, target.file);
  if (!fs.existsSync(file)) fail(`Missing artifact HTML: ${target.file}`);

  let html = fs.readFileSync(file, 'utf8');
  const directRe = /(\s)src=(["'])(\/?logo\.png)\2/g;
  const fallbackRe = /this\.src=(["'])logo\.png\1/g;

  const directBefore = countMatches(html, directRe);
  const fallbackBefore = countMatches(html, fallbackRe);
  if (directBefore !== target.direct) {
    fail(`${target.file} expected ${target.direct} direct logo.png reference(s); found ${directBefore}`);
  }
  if (fallbackBefore !== target.fallback) {
    fail(`${target.file} expected ${target.fallback} logo fallback reference(s); found ${fallbackBefore}`);
  }

  html = html.replace(directRe, (_match, whitespace, quote, oldPath) => {
    const prefix = oldPath.startsWith('/') ? '/' : '';
    return `${whitespace}src=${quote}${prefix}${OPTIMIZED_LOGO}${quote} width=${quote}384${quote} height=${quote}384${quote}`;
  });
  html = html.replace(fallbackRe, (_match, quote) => `this.src=${quote}${OPTIMIZED_LOGO}${quote}`);

  if (/(\s)src=(["'])(\/?logo\.png)\2/.test(html)) fail(`${target.file} still directly requests logo.png`);
  if (/this\.src=(["'])logo\.png\1/.test(html)) fail(`${target.file} still contains the old logo.png fallback`);
  if (html.includes('logo.png')) fail(`${target.file} still contains an unexpected logo.png reference`);

  const optimizedDirectRe = new RegExp(`(\\s)src=(["'])(\\/?${OPTIMIZED_LOGO.replace('.', '\\.')})\\2`, 'g');
  const optimizedDirect = countMatches(html, optimizedDirectRe);
  if (optimizedDirect !== target.direct) {
    fail(`${target.file} expected ${target.direct} optimized logo reference(s); found ${optimizedDirect}`);
  }

  fs.writeFileSync(file, html, 'utf8');
}

function run() {
  const optimized = path.join(OUT, OPTIMIZED_LOGO);
  const source = path.join(OUT, 'logo.png');
  if (!fs.existsSync(optimized)) fail(`${OPTIMIZED_LOGO} is missing from the strict production artifact`);
  if (!fs.existsSync(source)) fail('Original logo.png source asset must remain preserved in the artifact');

  for (const target of TARGETS) rewriteHtml(target);

  const manifestPath = path.join(OUT, 'release.json');
  if (!fs.existsSync(manifestPath)) fail('release.json is missing');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.files || manifest.files[OPTIMIZED_LOGO] !== sha256(optimized)) {
    fail(`${OPTIMIZED_LOGO} must already be allowlisted and hashed by the strict artifact build`);
  }
  for (const target of TARGETS) {
    manifest.files[target.file] = sha256(path.join(OUT, target.file));
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`[logo-delivery] Rewrote ${TARGETS.reduce((sum, target) => sum + target.direct, 0)} production logo request(s) to ${OPTIMIZED_LOGO}.`);
  console.log('[logo-delivery] Original logo.png remains preserved but is no longer on the HTML request path.');
}

if (require.main === module) run();

module.exports = { OPTIMIZED_LOGO, TARGETS, run };
