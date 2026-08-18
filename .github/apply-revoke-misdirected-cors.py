from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path, old, new):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one anchor, found {count}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

replace_once(
    'server.js',
    "const productionAllowedOrigins = [\n    'https://mywingman.com',\n    'https://mywingman.pages.dev'\n];",
    "const productionAllowedOrigins = [\n    'https://mywingman.pages.dev'\n];"
)
replace_once(
    'server.js',
    "    if (origin === '*' || origin === 'null' || origin.includes('*')) return false;\n    if (/^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/i.test(origin)) return false;",
    "    if (origin === '*' || origin === 'null' || origin.includes('*')) return false;\n    if (origin === 'https://mywingman.com') return false;\n    if (/^https?:\\/\\/(localhost|127\\.0\\.1)(:\\d+)?$/i.test(origin)) return false;"
)

replace_once(
    'railway-server.js',
    "const GATEWAY_PRODUCTION_ALLOWED_ORIGINS = [\n    'https://mywingman.com',\n    'https://mywingman.pages.dev'\n];",
    "const GATEWAY_PRODUCTION_ALLOWED_ORIGINS = [\n    'https://mywingman.pages.dev'\n];"
)
replace_once(
    'railway-server.js',
    "        if (origin === '*' || origin === 'null' || origin.includes('*')) return false;\n        if (/^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/i.test(origin)) return false;",
    "        if (origin === '*' || origin === 'null' || origin.includes('*')) return false;\n        if (origin === 'https://mywingman.com') return false;\n        if (/^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/i.test(origin)) return false;"
)
replace_once(
    'railway-server.js',
    '// Mirror the same production allowlist here so legitimate Cloudflare/custom-domain browsers\n    // can read those errors, while hostile/retired Netlify origins still receive no CORS grant.',
    '// Mirror the same production allowlist here so the verified Cloudflare browser origin\n    // can read those errors, while stale/retired origins still receive no CORS grant.'
)

replace_once(
    '.env.example',
    'ALLOWED_ORIGINS="https://mywingman.pages.dev,https://mywingman.com"',
    'ALLOWED_ORIGINS="https://mywingman.pages.dev"'
)

replace_once(
    'tests/cors_production_policy.test.js',
    "assert.ok(server.includes(\"'https://mywingman.com'\"), 'Custom production domain must remain allowed');",
    "assert.ok(!productionOriginsBlock[1].includes('https://mywingman.com'), 'Misdirected mywingman.com must not be a production CORS default');"
)
replace_once(
    'tests/cors_production_policy.test.js',
    "assert.ok(server.includes(\"if (origin === '*' || origin === 'null' || origin.includes('*')) return false;\"), 'Production configured origins must reject wildcard/null values');",
    "assert.ok(server.includes(\"if (origin === '*' || origin === 'null' || origin.includes('*')) return false;\"), 'Production configured origins must reject wildcard/null values');\nassert.ok(server.includes(\"if (origin === 'https://mywingman.com') return false;\"), 'Production configured origins must permanently reject the misdirected mywingman.com host');"
)

replace_once(
    'tests/runtime_startup_csp_hardening.test.js',
    "assert.ok(envExample.includes('ALLOWED_ORIGINS=\"https://mywingman.pages.dev,https://mywingman.com\"'), 'production origin example must use the exact Cloudflare and future custom-domain origins');",
    "assert.ok(envExample.includes('ALLOWED_ORIGINS=\"https://mywingman.pages.dev\"'), 'production origin example must use only the verified Cloudflare Pages origin');\nassert.ok(!envExample.includes('https://mywingman.com'), 'production origin example must not trust the misdirected mywingman.com host');"
)

railway_test = ROOT / 'tests' / 'railway_request_admission.test.js'
text = railway_test.read_text(encoding='utf-8')
anchor = "process.env.ALLOWED_ORIGINS = originalAllowedOrigins;"
if text.count(anchor) != 1:
    raise SystemExit(f'railway_request_admission.test.js: expected one restore anchor, found {text.count(anchor)}')
insert = """process.env.ALLOWED_ORIGINS = 'https://mywingman.com,https://preview.mywingman.com';
    const staleConfigured = getGatewayAllowedOrigins();
    assert.strictEqual(staleConfigured.has('https://mywingman.com'), false, 'stale mywingman.com must remain denied even when configured');
    assert.strictEqual(staleConfigured.has('https://preview.mywingman.com'), true, 'other explicit HTTPS configured origins must remain available');

    """ + anchor
railway_test.write_text(text.replace(anchor, insert, 1), encoding='utf-8')

new_test = ROOT / 'tests' / 'misdirected_domain_cors.test.js'
new_test.write_text("""'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const railway = fs.readFileSync(path.join(root, 'railway-server.js'), 'utf8');
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

console.log('Running misdirected-domain CORS revocation guard...');

for (const [label, source, declaration] of [
  ['inner API', server, 'const productionAllowedOrigins = ['],
  ['Railway admission', railway, 'const GATEWAY_PRODUCTION_ALLOWED_ORIGINS = [']
]) {
  const start = source.indexOf(declaration);
  assert(start >= 0, `${label}: production allowlist declaration missing`);
  const end = source.indexOf('];', start);
  assert(end > start, `${label}: production allowlist terminator missing`);
  const block = source.slice(start, end + 2);
  assert(block.includes('https://mywingman.pages.dev'), `${label}: verified Pages origin must remain trusted`);
  assert(!block.includes('https://mywingman.com'), `${label}: misdirected domain must not remain a default origin`);
  assert(source.includes("if (origin === 'https://mywingman.com') return false;"), `${label}: stale configured domain must be explicitly rejected in production`);
}

assert.strictEqual(envExample.includes('ALLOWED_ORIGINS="https://mywingman.pages.dev"'), true, 'environment template must trust only Pages by default');
assert.strictEqual(envExample.includes('https://mywingman.com'), false, 'environment template must not advertise stale domain trust');

console.log('✅ Pages remains trusted while mywingman.com is permanently denied by both production CORS layers.');
""", encoding='utf-8')

run_path = ROOT / 'tests' / 'run_all_tests.js'
run = run_path.read_text(encoding='utf-8')
anchor = "    { name: '55. Persisted Paid Plan State & O(1) Lookup Guard', file: 'paid_plan_state.test.js' }\n];"
replacement = "    { name: '55. Persisted Paid Plan State & O(1) Lookup Guard', file: 'paid_plan_state.test.js' },\n    { name: '56. Misdirected Custom-Domain CORS Revocation Guard', file: 'misdirected_domain_cors.test.js' }\n];"
if run.count(anchor) != 1:
    raise SystemExit('run_all_tests.js: expected main-base suite anchor exactly once')
run_path.write_text(run.replace(anchor, replacement, 1), encoding='utf-8')

print('Stale custom-domain CORS revocation patch applied.')
