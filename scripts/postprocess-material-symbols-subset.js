'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');

// Icons whose names are selected dynamically at runtime rather than appearing as literal
// material-symbol spans or same-variable className/textContent pairs in the public artifact.
const DYNAMIC_ICONS = Object.freeze([
  'check_circle',
  'close',
  'crop',
  'delete_forever',
  'error',
  'info',
  'progress_activity',
  'verified_user',
  'visibility',
  'visibility_off',
  'warning'
]);

const MATERIAL_CSS_RE = /https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Outlined:wght,FILL@100\.\.700,0\.\.1&display=block/g;
const STATIC_ICON_RE = /class=["'][^"']*material-symbols-outlined[^"']*["'][^>]*>\s*([a-z0-9_]+)\s*</g;
const PROGRAMMATIC_CLASS_THEN_TEXT_RE = /([A-Za-z_$][\w$]*)\.className\s*=\s*["'][^"']*material-symbols-outlined[^"']*["'][\s\S]{0,600}?\1\.textContent\s*=\s*["']([a-z0-9_]+)["']/g;
const PROGRAMMATIC_TEXT_THEN_CLASS_RE = /([A-Za-z_$][\w$]*)\.textContent\s*=\s*["']([a-z0-9_]+)["'][\s\S]{0,600}?\1\.className\s*=\s*["'][^"']*material-symbols-outlined[^"']*["']/g;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function collectStaticIcons(source) {
  const icons = new Set();
  let match;
  STATIC_ICON_RE.lastIndex = 0;
  while ((match = STATIC_ICON_RE.exec(source)) !== null) icons.add(match[1]);
  return icons;
}

function collectProgrammaticIcons(source) {
  const icons = new Set();
  let match;
  PROGRAMMATIC_CLASS_THEN_TEXT_RE.lastIndex = 0;
  while ((match = PROGRAMMATIC_CLASS_THEN_TEXT_RE.exec(source)) !== null) icons.add(match[2]);
  PROGRAMMATIC_TEXT_THEN_CLASS_RE.lastIndex = 0;
  while ((match = PROGRAMMATIC_TEXT_THEN_CLASS_RE.exec(source)) !== null) icons.add(match[2]);
  return icons;
}

function collectUsedIcons() {
  const icons = new Set(DYNAMIC_ICONS);
  const sources = ['index.html', 'app.html', 'app.js', 'accessibility.js', 'vendor/production-runtime.js'];
  for (const relative of sources) {
    const file = path.join(OUT, relative);
    if (!fs.existsSync(file)) throw new Error(`[material-symbols-subset] Missing artifact file: ${relative}`);
    const source = fs.readFileSync(file, 'utf8');
    for (const icon of collectStaticIcons(source)) icons.add(icon);
    for (const icon of collectProgrammaticIcons(source)) icons.add(icon);
  }
  return [...icons].sort((a, b) => a.localeCompare(b));
}

function rewriteHtml(relativeFile, subsetUrl) {
  const file = path.join(OUT, relativeFile);
  let html = fs.readFileSync(file, 'utf8');
  const matches = html.match(MATERIAL_CSS_RE) || [];
  if (matches.length !== 1) {
    throw new Error(`[material-symbols-subset] Expected exactly one full Material Symbols stylesheet in ${relativeFile}; found ${matches.length}`);
  }
  html = html.replace(MATERIAL_CSS_RE, subsetUrl);
  fs.writeFileSync(file, html, 'utf8');
}

function run() {
  const icons = collectUsedIcons();
  if (!icons.length) throw new Error('[material-symbols-subset] No Material Symbols icon names were discovered');

  const encodedNames = icons.join(',');
  const subsetUrl = `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&icon_names=${encodedNames}&display=block`;
  if (subsetUrl.length > 1900) {
    throw new Error(`[material-symbols-subset] Subset URL is unexpectedly long (${subsetUrl.length} chars)`);
  }

  rewriteHtml('index.html', subsetUrl);
  rewriteHtml('app.html', subsetUrl);

  const manifestPath = path.join(OUT, 'release.json');
  if (!fs.existsSync(manifestPath)) throw new Error('[material-symbols-subset] release.json is missing');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const rel of ['index.html', 'app.html']) manifest.files[rel] = sha256(path.join(OUT, rel));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`[material-symbols-subset] Material Symbols limited to ${icons.length} used icons.`);
  console.log(`[material-symbols-subset] icon_names=${encodedNames}`);
}

if (require.main === module) run();

module.exports = {
  DYNAMIC_ICONS,
  MATERIAL_CSS_RE,
  collectStaticIcons,
  collectProgrammaticIcons,
  collectUsedIcons,
  run
};
