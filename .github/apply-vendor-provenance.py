from pathlib import Path
import hashlib, json, re

ROOT = Path(__file__).resolve().parents[1]

package_path = ROOT / 'package.json'
package = package_path.read_text(encoding='utf-8')
old_dep = '"@supabase/supabase-js": "^2.112.3"'
new_dep = '"@supabase/supabase-js": "2.112.3"'
if package.count(old_dep) != 1:
    raise SystemExit(f'package.json: expected one Supabase caret dependency, found {package.count(old_dep)}')
package_path.write_text(package.replace(old_dep, new_dep, 1), encoding='utf-8')

lock_path = ROOT / 'package-lock.json'
lock = lock_path.read_text(encoding='utf-8')
if lock.count(old_dep) != 1:
    raise SystemExit(f'package-lock.json: expected one root Supabase caret dependency, found {lock.count(old_dep)}')
lock_path.write_text(lock.replace(old_dep, new_dep, 1), encoding='utf-8')

entries = [
    {
        'path': 'vendor/supabase.min.js',
        'package': '@supabase/supabase-js',
        'version': '2.112.3',
        'license': 'MIT',
        'source': 'https://github.com/supabase/supabase-js',
        'provenance': 'Pinned UMD browser build; file header identifies @supabase/supabase-js@2.112.3.',
        'reviewStatus': 'tracked'
    },
    {
        'path': 'vendor/cropperjs/cropper.min.js',
        'package': 'cropperjs',
        'version': '1.5.13',
        'license': 'MIT',
        'source': 'https://github.com/fengyuanchen/cropperjs/releases/tag/v1.5.13',
        'provenance': 'Pinned v1.5.13 browser runtime.',
        'reviewStatus': 'tracked'
    },
    {
        'path': 'vendor/cropperjs/cropper.min.css',
        'package': 'cropperjs',
        'version': '1.5.13',
        'license': 'MIT',
        'source': 'https://github.com/fengyuanchen/cropperjs/releases/tag/v1.5.13',
        'provenance': 'Pinned v1.5.13 browser stylesheet paired with the runtime.',
        'reviewStatus': 'tracked'
    },
    {
        'path': 'vendor/heic2any.min.js',
        'package': 'heic2any',
        'version': '0.0.4',
        'license': 'Upstream package declares MIT; embedded libheif licensing is disputed upstream',
        'source': 'https://github.com/alexcorvi/heic2any/releases/tag/0.0.4',
        'provenance': 'Pinned legacy browser converter. Upstream version 0.0.4 is the latest release.',
        'reviewStatus': 'replacement-required',
        'reviewReference': 'https://github.com/alexcorvi/heic2any/issues/59'
    }
]

for entry in entries:
    p = ROOT / entry['path']
    if not p.exists() or not p.is_file():
        raise SystemExit(f'missing vendored file: {entry["path"]}')
    data = p.read_bytes()
    entry['bytes'] = len(data)
    entry['sha256'] = hashlib.sha256(data).hexdigest()

# Validate available embedded version markers instead of trusting labels blindly.
supabase_head = (ROOT / 'vendor/supabase.min.js').read_text(encoding='utf-8', errors='ignore')[:1000]
if '@supabase/supabase-js@2.112.3' not in supabase_head:
    raise SystemExit('Supabase vendored header does not identify 2.112.3')
cropper_head = (ROOT / 'vendor/cropperjs/cropper.min.js').read_text(encoding='utf-8', errors='ignore')[:1000]
if 'Cropper.js v1.5.13' not in cropper_head:
    raise SystemExit('Cropper vendored header does not identify v1.5.13')

manifest = {
    'schemaVersion': 1,
    'purpose': 'Exact provenance and byte-integrity inventory for third-party browser bundles copied into the public artifact.',
    'thirdPartyRuntime': entries
}
config_dir = ROOT / 'config'
config_dir.mkdir(exist_ok=True)
(config_dir / 'browser-vendor-provenance.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

dependabot_dir = ROOT / '.github'
dependabot = '''version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    versioning-strategy: increase-if-necessary
  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
'''
(dependabot_dir / 'dependabot.yml').write_text(dependabot, encoding='utf-8')

test = r'''\'use strict\';

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
  'vendor/heic2any.min.js',
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
const heic = manifest.thirdPartyRuntime.find(entry => entry.package === 'heic2any');
assert.strictEqual(heic.version, '0.0.4');
assert.strictEqual(heic.reviewStatus, 'replacement-required', 'Known HEIC upstream licensing issue must remain explicitly tracked until replacement lands.');
assert(heic.reviewReference.includes('/heic2any/issues/59'), 'HEIC licensing review reference must remain explicit.');

assert(dependabot.includes('package-ecosystem: npm'), 'Dependabot must monitor npm dependencies.');
assert(dependabot.includes('package-ecosystem: github-actions'), 'Dependabot must monitor GitHub Actions.');
assert((dependabot.match(/interval: weekly/g) || []).length === 2, 'Both dependency ecosystems must be checked weekly.');

console.log('✅ Browser vendor bytes/provenance are locked, Supabase is exact-pinned, and automated dependency monitoring is enabled.');
'''.replace("\\'use strict\\';", "'use strict';")
(ROOT / 'tests' / 'browser_vendor_provenance.test.js').write_text(test, encoding='utf-8')

run_path = ROOT / 'tests' / 'run_all_tests.js'
run = run_path.read_text(encoding='utf-8')
anchor = "    { name: '58. Production CSS Compatibility Artifact Lock', file: 'production_css_compat_lock.test.js' }\n];"
replacement = "    { name: '58. Production CSS Compatibility Artifact Lock', file: 'production_css_compat_lock.test.js' },\n    { name: '59. Browser Vendor Provenance & Dependency Monitoring', file: 'browser_vendor_provenance.test.js' }\n];"
if run.count(anchor) != 1:
    raise SystemExit('run_all_tests.js current-main suite anchor mismatch')
run_path.write_text(run.replace(anchor, replacement, 1), encoding='utf-8')

print('Browser vendor provenance patch applied.')
