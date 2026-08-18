from pathlib import Path
import hashlib

ROOT = Path(__file__).resolve().parents[1]
css_path = ROOT / 'output.css'
css = css_path.read_bytes()
sha = hashlib.sha256(css).hexdigest()
size = len(css)
print(f'locking output.css bytes={size} sha256={sha}')

verify = f'''\'use strict\';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSS = path.join(ROOT, 'output.css');
const EXPECTED_BYTES = {size};
const EXPECTED_SHA256 = '{sha}';

function sha256(file) {{
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}}

function verifyProductionCss() {{
  if (!fs.existsSync(CSS) || !fs.statSync(CSS).isFile()) {{
    throw new Error('[production-css-lock] output.css is missing.');
  }}
  const bytes = fs.statSync(CSS).size;
  const hash = sha256(CSS);
  if (bytes !== EXPECTED_BYTES || hash !== EXPECTED_SHA256) {{
    throw new Error(`[production-css-lock] output.css drifted from the audited compatibility artifact. expected bytes=${{EXPECTED_BYTES}} sha256=${{EXPECTED_SHA256}}; found bytes=${{bytes}} sha256=${{hash}}. Generate a candidate with npm run build:css:candidate and validate it before intentionally updating this lock.`);
  }}
  console.log(`[production-css-lock] output.css verified: ${{bytes}} bytes sha256=${{hash}}`);
  return {{ bytes, hash }};
}}

if (require.main === module) verifyProductionCss();
module.exports = {{ EXPECTED_BYTES, EXPECTED_SHA256, verifyProductionCss }};
'''.replace("\\'use strict\\';", "'use strict';")
(ROOT / 'scripts' / 'verify-production-css.js').write_text(verify, encoding='utf-8')

candidate = ''''use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyProductionCss } = require('./verify-production-css');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'tmp');
const CANDIDATE = path.join(TMP, 'output.candidate.css');
const WATCH = process.argv.includes('--watch');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const before = verifyProductionCss();
fs.mkdirSync(TMP, { recursive: true });
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['@tailwindcss/cli', '-i', './input.css', '-o', './tmp/output.candidate.css'];
if (!WATCH) args.push('--minify');
if (WATCH) args.push('--watch');

console.log(`[css-candidate] Writing only ${path.relative(ROOT, CANDIDATE)}; audited output.css will not be modified.`);
const result = spawnSync(npx, args, { cwd: ROOT, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const after = verifyProductionCss();
if (before.hash !== after.hash || before.bytes !== after.bytes) {
  throw new Error('[css-candidate] production output.css changed during candidate generation.');
}
if (!WATCH) {
  if (!fs.existsSync(CANDIDATE)) throw new Error('[css-candidate] candidate file was not generated.');
  console.log(`[css-candidate] candidate bytes=${fs.statSync(CANDIDATE).size} sha256=${sha256(CANDIDATE)}`);
}
'''
(ROOT / 'scripts' / 'build-css-candidate.js').write_text(candidate, encoding='utf-8')

package_path = ROOT / 'package.json'
package = package_path.read_text(encoding='utf-8')
old = '''    "build:css": "npx @tailwindcss/cli -i ./input.css -o ./output.css --minify",\n    "build:netlify": "node scripts/build-netlify-dist.js && node scripts/postprocess-lazy-heic.js && node scripts/postprocess-deferred-media.js && node scripts/postprocess-vendor-allowlist.js && node scripts/postprocess-deferred-runtime.js && node scripts/postprocess-material-symbols-subset.js && node scripts/postprocess-logo-delivery.js && node scripts/postprocess-inline-critical-css.js && node scripts/postprocess-inline-cropper-css.js && node scripts/postprocess-self-host-main-fonts.js && node scripts/postprocess-self-host-material-symbols.js",\n    "watch:css": "npx @tailwindcss/cli -i ./input.css -o ./output.css --watch",'''
new = '''    "build:css": "node scripts/verify-production-css.js",\n    "build:css:candidate": "node scripts/build-css-candidate.js",\n    "build:netlify": "node scripts/verify-production-css.js && node scripts/build-netlify-dist.js && node scripts/postprocess-lazy-heic.js && node scripts/postprocess-deferred-media.js && node scripts/postprocess-vendor-allowlist.js && node scripts/postprocess-deferred-runtime.js && node scripts/postprocess-material-symbols-subset.js && node scripts/postprocess-logo-delivery.js && node scripts/postprocess-inline-critical-css.js && node scripts/postprocess-inline-cropper-css.js && node scripts/postprocess-self-host-main-fonts.js && node scripts/postprocess-self-host-material-symbols.js",\n    "watch:css": "node scripts/build-css-candidate.js --watch",'''
if package.count(old) != 1:
    raise SystemExit(f'package.json CSS scripts anchor mismatch: {package.count(old)}')
package_path.write_text(package.replace(old, new, 1), encoding='utf-8')

test = ''''use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'output.css');
const candidate = path.join(root, 'tmp', 'output.candidate.css');
const verifierSource = fs.readFileSync(path.join(root, 'scripts', 'verify-production-css.js'), 'utf8');
const candidateSource = fs.readFileSync(path.join(root, 'scripts', 'build-css-candidate.js'), 'utf8');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

console.log('Running production CSS compatibility artifact guard...');

assert.strictEqual(packageJson.scripts['build:css'], 'node scripts/verify-production-css.js', 'build:css must no longer overwrite production output.css');
assert.strictEqual(packageJson.scripts['build:css:candidate'], 'node scripts/build-css-candidate.js', 'candidate build command must be explicit');
assert.strictEqual(packageJson.scripts['watch:css'], 'node scripts/build-css-candidate.js --watch', 'CSS watch mode must write only the candidate path');
assert(packageJson.scripts['build:netlify'].startsWith('node scripts/verify-production-css.js && '), 'production artifact build must fail closed on CSS drift before packaging');
assert(!packageJson.scripts['build:css'].includes('-o ./output.css'), 'build:css must never target output.css');
assert(!packageJson.scripts['watch:css'].includes('-o ./output.css'), 'watch:css must never target output.css');
assert(candidateSource.includes("'./tmp/output.candidate.css'"), 'candidate build must target ignored tmp/output.candidate.css');
assert(!candidateSource.includes("'-o', './output.css'"), 'candidate helper must not write output.css');
assert(verifierSource.includes('EXPECTED_SHA256'), 'production CSS verifier must use an exact SHA-256 lock');
assert(verifierSource.includes('EXPECTED_BYTES'), 'production CSS verifier must use an exact byte-size lock');

const beforeHash = sha256(output);
const beforeBytes = fs.statSync(output).size;
execFileSync(process.execPath, [path.join(root, 'scripts', 'verify-production-css.js')], { cwd: root, stdio: 'inherit' });
fs.rmSync(candidate, { force: true });
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-css-candidate.js')], { cwd: root, stdio: 'inherit' });
assert(fs.existsSync(candidate), 'candidate CSS must be generated in ignored tmp directory');
assert.strictEqual(sha256(output), beforeHash, 'candidate generation must not change production output.css hash');
assert.strictEqual(fs.statSync(output).size, beforeBytes, 'candidate generation must not change production output.css size');
assert.notStrictEqual(sha256(candidate), beforeHash, 'current Tailwind regeneration must remain visibly distinct from the locked compatibility artifact until migration debt is resolved');

console.log('✅ Production output.css is byte-locked; candidate generation cannot overwrite it.');
'''
(ROOT / 'tests' / 'production_css_compat_lock.test.js').write_text(test, encoding='utf-8')

run_path = ROOT / 'tests' / 'run_all_tests.js'
run = run_path.read_text(encoding='utf-8')
anchor = "    { name: '57. Misdirected Custom-Domain CORS Revocation Guard', file: 'misdirected_domain_cors.test.js' }\n];"
replacement = "    { name: '57. Misdirected Custom-Domain CORS Revocation Guard', file: 'misdirected_domain_cors.test.js' },\n    { name: '58. Production CSS Compatibility Artifact Lock', file: 'production_css_compat_lock.test.js' }\n];"
if run.count(anchor) != 1:
    raise SystemExit('run_all_tests.js current-main suite anchor mismatch')
run_path.write_text(run.replace(anchor, replacement, 1), encoding='utf-8')

print('CSS compatibility artifact lock patch applied without modifying output.css.')
