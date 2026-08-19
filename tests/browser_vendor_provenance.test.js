'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'config', 'browser-vendor-provenance.json'), 'utf8'));
const dependabot = fs.readFileSync(path.join(root, '.github', 'dependabot.yml'), 'utf8');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

console.log('Running browser vendor provenance and dependency monitoring guard...');

assert.strictEqual(packageJson.dependencies['@supabase/supabase-js'], '2.112.3', 'Supabase SDK must be exact-pinned in package.json.');
assert.strictEqual(packageLock.packages[''].dependencies['@supabase/supabase-js'], '2.112.3', 'Supabase SDK root lock metadata must match exact package pin.');
assert.strictEqual(packageLock.packages['node_modules/@supabase/supabase-js'].version, '2.112.3', 'Installed Supabase SDK lock must remain 2.112.3.');

assert.strictEqual(manifest.schemaVersion, 1, 'Vendor provenance schema version drifted.');
const expectedPaths = [
  'vendor/cropperjs/cropper.min.css',
  'vendor/cropperjs/cropper.min.js',
  'vendor/heic-runtime/heic-to-csp.js',
  'vendor/supabase.min.js'
].sort();
const actualPaths = manifest.thirdPartyRuntime.map(entry => entry.path).sort();
assert.deepStrictEqual(actualPaths, expectedPaths, 'Third-party browser runtime inventory must be exhaustive for the public vendor allowlist.');

for (const entry of manifest.thirdPartyRuntime) {
  const file = path.join(root, entry.path);
  assert(fs.existsSync(file), `Vendored file missing: ${entry.path}`);
  assert.strictEqual(fs.statSync(file).size, entry.bytes, `Vendored byte-size drift: ${entry.path}`);
  assert.strictEqual(sha256(file), entry.sha256, `Vendored SHA-256 drift: ${entry.path}`);
  assert(/^https:\/\/github\.com\//.test(entry.source), `Vendored source must be an explicit GitHub upstream: ${entry.path}`);
  assert(entry.version && entry.license && entry.reviewStatus, `Vendored provenance metadata incomplete: ${entry.path}`);
}

const supabase = manifest.thirdPartyRuntime.find(entry => entry.package === '@supabase/supabase-js');
assert.strictEqual(supabase.version, '2.112.3');
assert(fs.readFileSync(path.join(root, supabase.path), 'utf8').slice(0, 1000).includes('@supabase/supabase-js@2.112.3'), 'Supabase vendored version marker drifted.');
const cropper = manifest.thirdPartyRuntime.find(entry => entry.package === 'cropperjs' && entry.path.endsWith('.js'));
assert.strictEqual(cropper.version, '1.5.13');
assert(fs.readFileSync(path.join(root, cropper.path), 'utf8').slice(0, 1000).includes('Cropper.js v1.5.13'), 'Cropper vendored version marker drifted.');
const heic = manifest.thirdPartyRuntime.find(entry => entry.package === 'heic-to');
assert.strictEqual(heic.version, 'f37af866f9aa6212ddc84b67a279c9f2386aba4f');
assert.strictEqual(heic.reviewStatus, 'approved', 'HEIC replacement must be approved and no longer require replacement.');
assert(!heic.reviewReference, 'HEIC licensing review reference should be removed after replacement lands.');

assert(dependabot.includes('package-ecosystem: npm'), 'Dependabot must monitor npm dependencies.');
assert(dependabot.includes('package-ecosystem: github-actions'), 'Dependabot must monitor GitHub Actions.');
assert((dependabot.match(/interval: weekly/g) || []).length === 2, 'Both dependency ecosystems must be checked weekly.');

console.log('✅ Browser vendor bytes/provenance are locked, Supabase is exact-pinned, and automated dependency monitoring is enabled.');
