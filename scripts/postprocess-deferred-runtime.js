'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function replaceExactlyOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`[deferred-runtime-build] Expected exactly one ${label}; found ${count}`);
  }
  return text.replace(from, to);
}

function deferScripts(relativeFile, scripts) {
  const file = path.join(OUT, relativeFile);
  if (!fs.existsSync(file)) throw new Error(`[deferred-runtime-build] Missing artifact file: ${relativeFile}`);

  let html = fs.readFileSync(file, 'utf8');
  for (const spec of scripts) {
    html = replaceExactlyOnce(
      html,
      `<script src="${spec.src}"></script>`,
      `<script defer src="${spec.src}"></script>`,
      `${relativeFile} script ${spec.src}`
    );
  }
  fs.writeFileSync(file, html, 'utf8');
}

// Preserve the dependency order while letting the HTML parser construct and paint the page
// without waiting for the authentication/runtime bundles. Deferred scripts execute in document
// order and before DOMContentLoaded.
deferScripts('index.html', [
  { src: 'config.js' },
  { src: 'vendor/supabase.min.js' },
  { src: 'supabaseClient.js' },
  { src: 'accessibility.js' }
]);

deferScripts('app.html', [
  { src: './vendor/cropperjs/cropper.min.js' },
  { src: 'config.js' },
  { src: 'vendor/supabase.min.js' },
  { src: 'supabaseClient.js' },
  { src: 'app.js' },
  { src: 'accessibility.js' }
]);

const manifestPath = path.join(OUT, 'release.json');
if (!fs.existsSync(manifestPath)) throw new Error('[deferred-runtime-build] release.json is missing');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const rel of ['index.html', 'app.html']) {
  manifest.files[rel] = sha256(path.join(OUT, rel));
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('[deferred-runtime-build] Parser-blocking auth/app runtime scripts converted to ordered defer loading.');
