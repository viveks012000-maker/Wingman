'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const CSS_FILE = 'vendor/cropperjs/cropper.min.css';
const TARGET = 'app.html';
const INLINE_MARKER = `data-inline-source="${CSS_FILE}"`;

function fail(message) {
  throw new Error(`[inline-cropper-css] ${message}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run() {
  const cssPath = path.join(OUT, CSS_FILE);
  const htmlPath = path.join(OUT, TARGET);
  if (!fs.existsSync(cssPath)) fail(`${CSS_FILE} is missing from the strict production artifact`);
  if (!fs.existsSync(htmlPath)) fail(`${TARGET} is missing from the strict production artifact`);

  const css = fs.readFileSync(cssPath, 'utf8');
  if (!css.trim()) fail(`${CSS_FILE} is empty`);
  if (/<\/style/i.test(css)) fail(`${CSS_FILE} contains a closing style tag and cannot be inlined safely`);

  let html = fs.readFileSync(htmlPath, 'utf8');
  const linkRe = /<link\b[^>]*\bhref=(["'])\.\/?vendor\/cropperjs\/cropper\.min\.css\1[^>]*>/gi;
  const matches = [...html.matchAll(linkRe)];
  if (matches.length !== 1) fail(`${TARGET} expected exactly one Cropper stylesheet link; found ${matches.length}`);
  if (!/\brel=(["'])stylesheet\1/i.test(matches[0][0])) fail(`${TARGET} Cropper CSS link is not rel=stylesheet`);
  if ((html.match(new RegExp(INLINE_MARKER, 'g')) || []).length !== 0) fail(`${TARGET} already contains the inline Cropper marker`);

  const inline = `<style ${INLINE_MARKER}>\n${css}\n</style>`;
  html = html.replace(linkRe, inline);

  if (/\bhref=(["'])\.\/?vendor\/cropperjs\/cropper\.min\.css\1/i.test(html)) fail(`${TARGET} still requests Cropper CSS after inlining`);
  if ((html.match(new RegExp(INLINE_MARKER, 'g')) || []).length !== 1) fail(`${TARGET} must contain exactly one inline Cropper marker`);
  fs.writeFileSync(htmlPath, html, 'utf8');

  const manifestPath = path.join(OUT, 'release.json');
  if (!fs.existsSync(manifestPath)) fail('release.json is missing');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.files || manifest.files[CSS_FILE] !== sha256(cssPath)) fail(`${CSS_FILE} must remain preserved and correctly hashed in the strict artifact`);
  manifest.files[TARGET] = sha256(htmlPath);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`[inline-cropper-css] Inlined ${CSS_FILE} into ${TARGET}; source asset remains preserved.`);
}

if (require.main === module) run();

module.exports = { CSS_FILE, TARGET, INLINE_MARKER, run };
