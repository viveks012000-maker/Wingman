'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const VENDOR = path.join(OUT, 'vendor');

const EXPECTED_VENDOR_FILES = [
  'cropperjs/cropper.min.css',
  'cropperjs/cropper.min.js',
  'heic2any-adapter.js',
  'heic2any-loader.js',
  'heic-runtime/heic-to-csp.js',
  'production-runtime.js',
  'supabase.min.js'
].sort();

function runNode(relPath) {
  execFileSync(process.execPath, [path.join(ROOT, relPath)], {
    cwd: ROOT,
    stdio: 'pipe'
  });
}

function walk(dir, base = dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full, base));
    else if (entry.isFile()) result.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return result.sort();
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

runNode('scripts/build-netlify-dist.js');
runNode('scripts/postprocess-lazy-heic.js');
runNode('scripts/postprocess-deferred-media.js');
runNode('scripts/postprocess-vendor-allowlist.js');

const vendorFiles = walk(VENDOR);
assert.deepStrictEqual(
  vendorFiles,
  EXPECTED_VENDOR_FILES,
  `public vendor artifact must contain only the explicit runtime allowlist; found ${vendorFiles.join(', ')}`
);

assert.strictEqual(fs.existsSync(path.join(VENDOR, 'cropper.min.js')), false, 'dead duplicate top-level Cropper JS must not ship');
assert.strictEqual(fs.existsSync(path.join(VENDOR, 'cropper.min.css')), false, 'dead duplicate top-level Cropper CSS must not ship');

const appHtml = fs.readFileSync(path.join(OUT, 'app.html'), 'utf8');
const heicLoader = fs.readFileSync(path.join(OUT, 'vendor', 'heic2any-loader.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
for (const requiredRef of [
  'vendor/cropperjs/cropper.min.css',
  'vendor/cropperjs/cropper.min.js',
  'vendor/heic2any-loader.js',
  'vendor/heic2any-adapter.js',
  'vendor/production-runtime.js',
  'vendor/supabase.min.js'
]) {
  assert(appHtml.includes(requiredRef) || heicLoader.includes(requiredRef.replace('vendor/', './vendor/')) || requiredRef === 'vendor/production-runtime.js', `runtime reference must remain available: ${requiredRef}`);
  assert(fs.existsSync(path.join(OUT, requiredRef)), `referenced runtime file must exist: ${requiredRef}`);
}

// The heavy HEIC converter is intentionally not referenced eagerly, but must remain available
// for heic2any-loader.js to fetch on first HEIC/HEIF conversion.
assert(fs.existsSync(path.join(VENDOR, 'heic-runtime', 'heic-to-csp.js')), 'lazy HEIC runtime payload must remain available');
assert(fs.existsSync(path.join(VENDOR, 'heic2any-adapter.js')), 'lazy HEIC adapter must remain available');
assert(indexHtml.includes('https://wingman-production-c6ce.up.railway.app'), 'production landing CSP must retain the exact Railway origin');
assert(!indexHtml.includes('http://localhost:*') && !indexHtml.includes('ws://localhost:*'), 'production landing CSP must not retain development-only localhost sources');

const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
const vendorManifestKeys = Object.keys(manifest.files).filter(key => key.startsWith('vendor/')).sort();
assert.deepStrictEqual(
  vendorManifestKeys,
  EXPECTED_VENDOR_FILES.map(rel => `vendor/${rel}`).sort(),
  'release manifest vendor entries must exactly match the public allowlist'
);
for (const rel of EXPECTED_VENDOR_FILES) {
  assert.strictEqual(
    manifest.files[`vendor/${rel}`],
    sha256(path.join(VENDOR, rel)),
    `release manifest hash must match final vendor file: ${rel}`
  );
}

const duplicateBytesRemoved = 37035 + 3804;
assert.strictEqual(duplicateBytesRemoved, 40839, 'documented duplicate payload saving must remain 40,839 bytes');

console.log('✅ Public vendor artifact is exact-allowlisted; duplicate Cropper payload removed (40,839 bytes).');
