'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');

function runNode(relPath) {
  execFileSync(process.execPath, [path.join(ROOT, relPath)], {
    cwd: ROOT,
    stdio: 'pipe'
  });
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

runNode('scripts/build-netlify-dist.js');
runNode('scripts/postprocess-lazy-heic.js');
runNode('scripts/postprocess-deferred-media.js');

const expectedTag = '<img loading="lazy" decoding="async" fetchpriority="low" src="maeve.jpg"';
for (const relPath of ['index.html', 'app.html']) {
  const htmlPath = path.join(OUT, relPath);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const matches = html.match(/<img loading="lazy" decoding="async" fetchpriority="low" src="maeve\.jpg"/g) || [];
  assert.strictEqual(matches.length, 1, `${relPath} must defer exactly one Maeve image`);
  assert(html.includes(expectedTag), `${relPath} must preserve the Maeve image while deferring its fetch`);
}

const maevePath = path.join(OUT, 'maeve.jpg');
assert(fs.existsSync(maevePath), 'Maeve image must remain in the public artifact');
assert.strictEqual(fs.statSync(maevePath).size, 261241, 'Maeve image bytes must remain untouched by the loading optimization');

const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
for (const relPath of ['index.html', 'app.html']) {
  assert.strictEqual(
    manifest.files[relPath],
    sha256(path.join(OUT, relPath)),
    `release.json must contain the postprocessed ${relPath} hash`
  );
}

console.log('✅ Deferred Maeve media loading and artifact integrity regression guard passed.');
