'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const subset = require('../scripts/postprocess-material-symbols-subset');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function buildArtifact() {
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const script of [
    'scripts/build-netlify-dist.js',
    'scripts/postprocess-lazy-heic.js',
    'scripts/postprocess-deferred-media.js',
    'scripts/postprocess-vendor-allowlist.js',
    'scripts/postprocess-deferred-runtime.js',
    'scripts/postprocess-material-symbols-subset.js'
  ]) {
    execFileSync(process.execPath, [script], { cwd: ROOT, stdio: 'pipe' });
  }
}

function getSubsetUrl(html) {
  const match = html.match(/https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Outlined:[^"']+icon_names=[^"']+&display=block/);
  assert(match, 'Material Symbols subset stylesheet URL must exist');
  return match[0];
}

try {
  buildArtifact();

  const index = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(OUT, 'app.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(OUT, 'app.js'), 'utf8');

  const indexUrl = getSubsetUrl(index);
  const appUrl = getSubsetUrl(app);
  assert.strictEqual(indexUrl, appUrl, 'landing and dashboard must request the identical Material Symbols subset');
  assert(indexUrl.includes('Material+Symbols+Outlined:wght,FILL@100..700,0..1'), 'FILL and weight axes must remain available for existing active-state icon styling');
  assert(indexUrl.endsWith('&display=block'), 'display=block must remain to prevent ligature text flash');

  const namesPart = indexUrl.match(/[?&]icon_names=([^&]+)/)?.[1];
  assert(namesPart, 'icon_names parameter must be present');
  const names = namesPart.split(',');
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepStrictEqual(names, sorted, 'icon_names must be alphabetically sorted for the Google Fonts API');
  assert.strictEqual(new Set(names).size, names.length, 'icon_names must be unique');
  assert(names.length >= 10 && names.length < 200, `subset icon count must remain bounded; got ${names.length}`);
  assert(indexUrl.length < 1900, 'subset URL must remain safely below common URL-length limits');

  const expected = new Set(subset.DYNAMIC_ICONS);
  for (const source of [index, app, appJs]) {
    for (const icon of subset.collectStaticIcons(source)) expected.add(icon);
  }
  const missing = [...expected].filter(icon => !names.includes(icon)).sort();
  assert.deepStrictEqual(missing, [], `subset must include every static/dynamic icon: missing ${missing.join(', ')}`);

  const obsoleteFull = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=block';
  assert(!index.includes(obsoleteFull), 'landing must not request the full Material Symbols font');
  assert(!app.includes(obsoleteFull), 'dashboard must not request the full Material Symbols font');

  const release = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
  assert.strictEqual(release.files['index.html'], sha256(path.join(OUT, 'index.html')), 'release manifest must hash subsetted index.html');
  assert.strictEqual(release.files['app.html'], sha256(path.join(OUT, 'app.html')), 'release manifest must hash subsetted app.html');

  console.log(`✅ Material Symbols subset guard passed (${names.length} icons).`);
  console.log(`MATERIAL_SYMBOLS_SUBSET_URL=${indexUrl}`);
} finally {
  fs.rmSync(OUT, { recursive: true, force: true });
}
