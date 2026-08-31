'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const MANIFEST_PATH = path.join(OUT, 'release.json');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function deferMaeveImage(relPath) {
  const target = path.join(OUT, relPath);
  if (!fs.existsSync(target)) {
    throw new Error(`[deferred-media-build] Missing artifact file: ${relPath}`);
  }

  const original = fs.readFileSync(target, 'utf8');
  const pattern = /<img\s+src=(['"])maeve\.jpg\1/g;
  const matches = original.match(pattern) || [];
  if (matches.length !== 1) {
    throw new Error(`[deferred-media-build] Expected exactly one Maeve image in ${relPath}; found ${matches.length}`);
  }

  const updated = original.replace(
    pattern,
    '<img loading="lazy" decoding="async" fetchpriority="low" src="maeve.jpg"'
  );
  fs.writeFileSync(target, updated, 'utf8');
}

for (const relPath of ['index.html', 'app.html']) {
  deferMaeveImage(relPath);
}

if (!fs.existsSync(MANIFEST_PATH)) {
  throw new Error('[deferred-media-build] release.json is missing');
}
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
if (!manifest.files || typeof manifest.files !== 'object') {
  throw new Error('[deferred-media-build] release.json files map is invalid');
}
for (const relPath of ['index.html', 'app.html']) {
  manifest.files[relPath] = sha256(path.join(OUT, relPath));
}
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('[deferred-media-build] Noncritical Maeve imagery deferred from initial rendering.');
