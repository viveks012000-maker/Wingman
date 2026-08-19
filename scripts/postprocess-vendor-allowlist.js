'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const VENDOR = path.join(OUT, 'vendor');
const MANIFEST_PATH = path.join(OUT, 'release.json');

const ALLOWED_VENDOR_FILES = new Set([
  'cropperjs/cropper.min.css',
  'cropperjs/cropper.min.js',
  'heic2any-loader.js',
  'heic-runtime/heic-to-csp.js',
  'production-runtime.js',
  'supabase.min.js'
]);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full, base));
    else if (entry.isFile()) result.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return result.sort();
}

function pruneEmptyDirectories(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    pruneEmptyDirectories(child);
    if (fs.readdirSync(child).length === 0) fs.rmdirSync(child);
  }
}

if (!fs.existsSync(VENDOR)) {
  throw new Error('[vendor-allowlist-build] vendor directory is missing from artifact');
}

const before = walk(VENDOR);
for (const required of ALLOWED_VENDOR_FILES) {
  if (!before.includes(required)) {
    throw new Error(`[vendor-allowlist-build] Required runtime vendor file is missing: ${required}`);
  }
}

const removed = [];
for (const rel of before) {
  if (ALLOWED_VENDOR_FILES.has(rel)) continue;
  const full = path.join(VENDOR, rel);
  fs.rmSync(full, { force: true });
  removed.push(rel);
}
pruneEmptyDirectories(VENDOR);

const after = walk(VENDOR);
const expected = [...ALLOWED_VENDOR_FILES].sort();
if (JSON.stringify(after) !== JSON.stringify(expected)) {
  throw new Error(`[vendor-allowlist-build] Final vendor artifact differs from allowlist. Found: ${after.join(', ')}`);
}

if (!fs.existsSync(MANIFEST_PATH)) {
  throw new Error('[vendor-allowlist-build] release.json is missing');
}
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
if (!manifest.files || typeof manifest.files !== 'object') {
  throw new Error('[vendor-allowlist-build] release.json files map is invalid');
}

for (const key of Object.keys(manifest.files)) {
  if (key.startsWith('vendor/')) delete manifest.files[key];
}
for (const rel of expected) {
  const manifestKey = `vendor/${rel}`;
  manifest.files[manifestKey] = sha256(path.join(VENDOR, rel));
}
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`[vendor-allowlist-build] Vendor artifact locked to ${expected.length} runtime files; removed ${removed.length} non-allowlisted file(s).`);
if (removed.length) console.log(`[vendor-allowlist-build] Removed: ${removed.join(', ')}`);
