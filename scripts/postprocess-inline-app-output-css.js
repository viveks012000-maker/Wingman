'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EXPECTED_BYTES, EXPECTED_SHA256 } = require('./verify-production-css');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const CSS_FILE = 'output.css';
const APP_FILE = 'app.html';
const INLINE_MARKER = `data-inline-source="${CSS_FILE}"`;
const FONT_PRELOADS = Object.freeze([
  '/fonts/plus-jakarta-sans-normal-latin.woff2',
  '/fonts/material-symbols-outlined-subset.woff2'
]);

function fail(message) {
  throw new Error(`[inline-app-output-css] ${message}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run() {
  const sourceCssPath = path.join(ROOT, CSS_FILE);
  const artifactCssPath = path.join(OUT, CSS_FILE);
  const appPath = path.join(OUT, APP_FILE);
  for (const file of [sourceCssPath, artifactCssPath, appPath]) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`Required file is missing: ${path.relative(ROOT, file)}`);
  }
  const cssBuffer = fs.readFileSync(artifactCssPath);
  const cssHash = crypto.createHash('sha256').update(cssBuffer).digest('hex');
  if (cssBuffer.length !== EXPECTED_BYTES || cssHash !== EXPECTED_SHA256) fail('The app stylesheet no longer matches the byte-locked workspace stylesheet.');
  if (!cssBuffer.equals(fs.readFileSync(sourceCssPath))) fail('The built app stylesheet differs from the audited source stylesheet.');
  const css = cssBuffer.toString('utf8');
  if (!css.trim()) fail('The app stylesheet is empty.');
  if (/<\/style/i.test(css)) fail('The app stylesheet contains a closing style tag and cannot be inlined safely.');

  let html = fs.readFileSync(appPath, 'utf8');
  const stylesheetLink = /<link\b[^>]*\bhref=(['"])\.?\/?output\.css\1[^>]*>/gi;
  const matches = [...html.matchAll(stylesheetLink)];
  if (matches.length !== 1 || !/\brel=(['"])stylesheet\1/i.test(matches[0][0])) {
    fail(`Expected one app output.css stylesheet link; found ${matches.length}.`);
  }
  if ((html.match(new RegExp(INLINE_MARKER, 'g')) || []).length) fail('app.html already contains an output.css inline marker.');

  const viewportMeta = /<meta\b[^>]*\bname=(['"])viewport\1[^>]*>/gi;
  const viewportMatches = [...html.matchAll(viewportMeta)];
  if (viewportMatches.length !== 1) fail(`Expected one app viewport declaration; found ${viewportMatches.length}.`);
  for (const font of FONT_PRELOADS) {
    const asset = path.join(OUT, font.replace(/^\//, ''));
    if (!fs.existsSync(asset) || !fs.statSync(asset).isFile()) fail(`Required preloaded app font is missing: ${font}`);
    const existingPreload = (html.match(/<link\b[^>]*>/gi) || []).some(tag =>
      /\brel=(['"])preload\1/i.test(tag) && tag.includes(`href="${font}"`));
    if (existingPreload) {
      fail(`app.html already preloads ${font}.`);
    }
  }
  const preloads = FONT_PRELOADS.map(font => `<link rel="preload" href="${font}" as="font" type="font/woff2" crossorigin>`).join('\n    ');
  const inlineStylesheet = `<style ${INLINE_MARKER}>\n${css}\n</style>`;
  html = html.replace(matches[0][0], inlineStylesheet);
  html = html.replace(viewportMeta, `${viewportMatches[0][0]}\n    ${preloads}`);
  if (/<link\b[^>]*\bhref=(['"])\.?\/?output\.css\1[^>]*>/i.test(html)) fail('app.html still requests output.css as a separate stylesheet.');
  if ((html.match(new RegExp(INLINE_MARKER, 'g')) || []).length !== 1) fail('app.html must contain exactly one inline output.css marker.');
  for (const font of FONT_PRELOADS) {
    if ((html.match(new RegExp(`rel="preload" href="${font}" as="font" type="font/woff2" crossorigin`, 'g')) || []).length !== 1) {
      fail(`app.html must preload ${font} exactly once.`);
    }
  }

  fs.writeFileSync(appPath, html, 'utf8');
  const manifestPath = path.join(OUT, 'release.json');
  if (!fs.existsSync(manifestPath)) fail('release.json is missing.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files[APP_FILE] = sha256(appPath);
  if (manifest.files[CSS_FILE] !== EXPECTED_SHA256) fail('release.json must preserve the byte-locked output.css checksum.');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`[inline-app-output-css] Inlined the locked ${CSS_FILE} into ${APP_FILE} and preloaded the first-view app fonts.`);
}

if (require.main === module) run();
module.exports = { APP_FILE, CSS_FILE, FONT_PRELOADS, INLINE_MARKER, run };
