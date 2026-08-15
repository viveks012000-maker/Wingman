const fs = require('fs');

const serverPath = 'server.js';
let s = fs.readFileSync(serverPath, 'utf8');

const start = s.indexOf('// 2. Configure Locked CORS Policy');
const end = s.indexOf('// 3. Global Rate Limiter', start);
if (start < 0 || end < 0) throw new Error('CORS policy block not found');

const replacement = [
  '// 2. Configure Locked CORS Policy',
  'const productionAllowedOrigins = [',
  "    'https://mywingman.com',",
  "    'https://chimerical-granita-c68c5a.netlify.app'",
  '];',
  'const developmentAllowedOrigins = [',
  "    'http://localhost:3000',",
  "    'http://localhost:10000',",
  "    'http://127.0.0.1:3000',",
  "    'http://127.0.0.1:10000'",
  '];',
  'const defaultAllowedOrigins = IS_PROD',
  '    ? productionAllowedOrigins',
  '    : [...productionAllowedOrigins, ...developmentAllowedOrigins];',
  '',
  'const rawConfiguredAllowedOrigins = process.env.ALLOWED_ORIGINS',
  "    ? process.env.ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean)",
  '    : [];',
  '',
  '// Production must use explicit HTTPS origins. Ignore wildcard/null/localhost values even if',
  '// an old environment variable still contains them; this prevents stale deployment settings',
  '// from silently reopening browser access to arbitrary preview or local origins.',
  'const configuredAllowedOrigins = rawConfiguredAllowedOrigins.filter(origin => {',
  '    if (!IS_PROD) return true;',
  "    if (origin === '*' || origin === 'null' || origin.includes('*')) return false;",
  "    if (/^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/i.test(origin)) return false;",
  "    return /^https:\\/\\//i.test(origin);",
  '});',
  'const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...configuredAllowedOrigins]));',
  '',
  'function isOriginAllowed(origin, allowedList) {',
  '    // Requests without an Origin header (health checks, server-to-server clients) are not',
  '    // browser CORS requests and remain allowed. Opaque browser origins are denied in prod.',
  '    if (!origin) return true;',
  "    if (origin === 'null') return !IS_PROD;",
  '    if (allowedList.includes(origin)) return true;',
  '',
  '    // Development may use arbitrary localhost ports for local tooling, but production may not.',
  "    if (!IS_PROD && /^http:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/i.test(origin)) return true;",
  '    return false;',
  '}',
  '',
  'app.use(cors({',
  '    origin: function (origin, callback) {',
  "        if (!IS_PROD && (origin === 'null' || origin === 'file://')) {",
  '            return callback(null, true);',
  '        }',
  '        if (isOriginAllowed(origin, allowedOrigins)) {',
  '            return callback(null, true);',
  '        }',
  '        console.warn(`[SECURITY WARN] Blocked request from unauthorized origin: ${origin}`);',
  '        // CORS is a browser response policy, not an authentication boundary. Returning false',
  '        // omits ACAO without turning a blocked preflight into an internal-server-error response.',
  '        return callback(null, false);',
  '    },',
  '    credentials: true',
  '}));',
  '',
  ''
].join('\n');

s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(serverPath, s);

const testPath = 'tests/cors_production_policy.test.js';
const test = `const assert = require('assert');
const fs = require('fs');
const path = require('path');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

assert.ok(server.includes("'https://chimerical-granita-c68c5a.netlify.app'"), 'Netlify production origin must remain allowed');
assert.ok(server.includes("'https://mywingman.com'"), 'Custom production domain must remain allowed');
assert.ok(!server.includes("'https://*.pages.dev'"), 'Production defaults must not trust every Cloudflare Pages project');
assert.ok(server.includes("if (origin === 'null') return !IS_PROD;"), 'Opaque/null browser origins must be denied in production');
assert.ok(server.includes("if (origin === '*' || origin === 'null' || origin.includes('*')) return false;"), 'Production configured origins must reject wildcard/null values');
assert.ok(server.includes("if (!IS_PROD && /^http:\\\/\\\\/(localhost|127\\\\.0\\\\.0\\\\.1)"), 'Arbitrary localhost ports must be development-only');
assert.ok(server.includes('return callback(null, false);'), 'Disallowed browser origins should omit CORS permission without throwing a 500');
assert.ok(server.includes("if (!origin) return true;"), 'Server-to-server requests without Origin must remain available');

console.log('✔ Production CORS least-privilege policy regression guard passed.');
`;
fs.writeFileSync(testPath, test);

const runnerPath = 'tests/run_all_tests.js';
let runner = fs.readFileSync(runnerPath, 'utf8');
if (!runner.includes('cors_production_policy.test.js')) {
    const anchor = "    { name: '26. Post-Audit Correctness & DOM Sink Guard', file: 'post_audit_correctness.test.js' }\n";
    if (!runner.includes(anchor)) throw new Error('Runner anchor missing');
    runner = runner.replace(anchor,
        "    { name: '26. Post-Audit Correctness & DOM Sink Guard', file: 'post_audit_correctness.test.js' },\n" +
        "    { name: '27. Production CORS Least-Privilege Guard', file: 'cors_production_policy.test.js' }\n");
}
fs.writeFileSync(runnerPath, runner);

console.log('Production CORS policy patched and regression coverage added.');
