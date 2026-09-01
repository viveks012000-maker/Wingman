'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const CSS_FILE = 'style.css';
const TARGETS = Object.freeze(['index.html', 'app.html', '404.html', 'terms.html', 'privacy.html', 'refund.html']);
const INLINE_MARKER = `data-inline-source="${CSS_FILE}"`;

function fail(message) {
  throw new Error(`[inline-critical-css] ${message}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function inlineIntoHtml(relativeFile, css) {
  const file = path.join(OUT, relativeFile);
  if (!fs.existsSync(file)) fail(`Missing artifact HTML: ${relativeFile}`);

  let html = fs.readFileSync(file, 'utf8');
  const linkRe = /<link\b[^>]*\bhref=(["'])\/?style\.css\1[^>]*>/gi;
  const matches = [...html.matchAll(linkRe)];
  if (matches.length !== 1) {
    fail(`${relativeFile} expected exactly one style.css stylesheet link; found ${matches.length}`);
  }
  if (!/\brel=(["'])stylesheet\1/i.test(matches[0][0])) {
    fail(`${relativeFile} style.css link is not rel=stylesheet`);
  }
  if ((html.match(new RegExp(INLINE_MARKER, 'g')) || []).length !== 0) {
    fail(`${relativeFile} already contains the inline style marker`);
  }

  const inline = `<style ${INLINE_MARKER}>\n${css}\n</style>`;
  html = html.replace(linkRe, inline);

  if (/\bhref=(["'])\/?style\.css\1/i.test(html)) {
    fail(`${relativeFile} still requests style.css after inlining`);
  }
  if ((html.match(new RegExp(INLINE_MARKER, 'g')) || []).length !== 1) {
    fail(`${relativeFile} must contain exactly one inline style marker`);
  }

  fs.writeFileSync(file, html, 'utf8');
}

function run() {
  const cssPath = path.join(OUT, CSS_FILE);
  if (!fs.existsSync(cssPath)) fail(`${CSS_FILE} is missing from the strict production artifact`);
  const css = fs.readFileSync(cssPath, 'utf8');
  if (!css.trim()) fail(`${CSS_FILE} is empty`);
  if (/<\/style/i.test(css)) fail(`${CSS_FILE} contains a closing style tag and cannot be inlined safely`);

  for (const target of TARGETS) inlineIntoHtml(target, css);

  const manifestPath = path.join(OUT, 'release.json');
  if (!fs.existsSync(manifestPath)) fail('release.json is missing');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.files || manifest.files[CSS_FILE] !== sha256(cssPath)) {
    fail(`${CSS_FILE} must remain preserved and correctly hashed in the strict artifact`);
  }
  for (const target of TARGETS) {
    manifest.files[target] = sha256(path.join(OUT, target));
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`[inline-critical-css] Inlined ${CSS_FILE} into ${TARGETS.join(', ')}; source asset remains preserved.`);
}

if (require.main === module) run();

module.exports = { CSS_FILE, TARGETS, INLINE_MARKER, run };
